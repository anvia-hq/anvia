import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  type AgentResponse,
  AssistantContent,
  agentEvalTarget,
  answerRelevancy,
  assertEvalPassed,
  cachedEvalTarget,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  compareEvalResults,
  compareEvalTargets,
  contains,
  containsAll,
  containsAny,
  createEvalTypes,
  createFileEvalCache,
  createJudgeMetrics,
  createMemoryEvalCache,
  createTool,
  doesNotMatch,
  EvalAssertionError,
  EvalFailFastError,
  EvalOutcome,
  exactMatch,
  formatEvalComparison,
  formatEvalResult,
  llmJudge,
  loadEvalCases,
  loadEvalResult,
  matches,
  maxDurationMs,
  maxLength,
  maxTokens,
  maxTurns,
  notBlank,
  notContains,
  parseEvalCliArgs,
  predicate,
  requiredFields,
  runEvalCli,
  runEvalSuite,
  saveEvalResult,
  schemaMatch,
  toolCallOrder,
  toolCalled,
  toolNotCalled,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test-provider";
  readonly modelId = "test-judge-1";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: true,
    reasoning: false,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const next = this.responses.shift();

    if (next === undefined) throw new Error("No queued response");

    return next;
  }
}

function completion(
  choice: CompletionResponse["choice"],
  tokens = { input: 2, output: 1 },
): CompletionResponse {
  return {
    choice,
    usage: {
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      totalTokens: tokens.input + tokens.output,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rawResponse: {},
  };
}

function judgeResponse(data: unknown): CompletionResponse {
  return completion([AssistantContent.toolCall("call", "submit", data as never)]);
}

describe("evals DX improvements", () => {
  describe("runner diagnostics, fail-fast, metric summaries, and tags", () => {
    it("populates per-case usage and cost before emitting case-complete progress events", async () => {
      const seenInProgress: Array<{ totalTokens: number; totalCost?: number | undefined }> = [];
      const seenModels: Array<string | undefined> = [];
      const model = new QueueModel([judgeResponse({ passed: true, reason: "matches policy" })]);

      const result = await runEvalSuite({
        name: "progress-usage",
        cases: [{ id: "c1", input: "hello" }],
        target: (input) => ({
          output: input,
          usage: { ...Usage.empty(), inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        }),
        metrics: [
          llmJudge({
            model,
            schema: z.object({ passed: z.boolean(), reason: z.string() }),
            passes: (judgment) => judgment.passed,
          }),
        ],
        cost: {
          currency: "USD",
          calculate: (args) => {
            if (args.kind === "evaluation") seenModels.push(args.model?.modelId);

            return args.usage.totalTokens * 0.01;
          },
        },
        onProgress: (event) => {
          if (event.type === "case-complete") {
            seenInProgress.push({
              totalTokens: event.result.usage.total.totalTokens,
              totalCost: event.result.cost?.total,
            });
          }
        },
      });

      expect(result.passed).toBe(true);
      expect(seenInProgress).toEqual([{ totalTokens: 9, totalCost: 0.09 }]);
      expect(seenModels).toEqual(["test-judge-1"]);
      expect(result.results[0]?.scores.llm_judge?.comment).toBe("matches policy");
      expect(result.metricSummaries.llm_judge).toMatchObject({
        metricName: "llm_judge",
        passed: 1,
        failed: 0,
        invalid: 0,
        passRate: 1,
        meanScore: 1,
      });
    });

    it("attaches failing caseResult and partialResults to EvalFailFastError", async () => {
      let caught: unknown;
      try {
        await runEvalSuite({
          name: "fail-fast-details",
          cases: [
            { id: "c1", input: "ok", expected: "ok" },
            { id: "c2", input: "bad", expected: "ok" },
            { id: "c3", input: "never", expected: "never" },
          ],
          target: (input) => input,
          metrics: [exactMatch()],
          failFast: true,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EvalFailFastError);
      const err = caught as EvalFailFastError;
      expect(err.caseId).toBe("c2");
      expect(err.outcome).toBe("fail");
      expect(err.caseResult?.output).toBe("bad");
      expect(err.partialResults.map((entry) => entry.case.id)).toEqual(["c1", "c2"]);
    });

    it("filters cases by tags and computes numeric metric summaries", async () => {
      const result = await runEvalSuite({
        name: "tagged-summaries",
        cases: [
          { id: "refund", input: "refund", tags: ["billing", "smoke"] },
          { id: "security", input: "security", tags: ["security"] },
          { id: "invoice", input: "invoice", tags: ["billing"] },
        ],
        tags: ["billing"],
        target: (input) => input,
        metrics: [
          {
            name: "quality",
            dataType: "NUMERIC",
            threshold: 0.7,
            evaluate: ({ case: testCase }) =>
              testCase.id === "refund" ? EvalOutcome.pass(0.9) : EvalOutcome.fail(0.5),
          },
        ],
      });

      expect(result.results.map((entry) => entry.case.id)).toEqual(["refund", "invoice"]);
      expect(result.passed).toBe(false);
      expect(result.metricSummaries.quality).toMatchObject({
        total: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        meanScore: 0.7,
        minScore: 0.5,
        maxScore: 0.9,
      });
    });
  });

  describe("trials and target caching", () => {
    it("runs multiple trials and computes pass@k, passAllK, and minPassRate", async () => {
      let attempt = 0;
      const result = await runEvalSuite({
        name: "stochastic",
        cases: [{ id: "flaky", input: "q", expected: "ok" }],
        target: () => {
          attempt += 1;
          return attempt === 2 ? "wrong" : "ok";
        },
        metrics: [exactMatch()],
        trials: { count: 3, minPassRate: 2 / 3 },
      });

      const caseResult = result.results[0];
      expect(result.passed).toBe(true);
      expect(caseResult?.outcome).toBe("pass");
      expect(caseResult?.trials).toMatchObject({
        count: 3,
        passed: 2,
        failed: 1,
        invalid: 0,
        passAtK: true,
        passAllK: false,
      });
      expect(caseResult?.trials?.runs).toHaveLength(3);
    });

    it("fails a multi-trial case when pass rate is below minPassRate and surfaces a failing trial", async () => {
      let attempt = 0;
      const result = await runEvalSuite({
        name: "strict-trials",
        cases: [{ id: "flaky", input: "q", expected: "ok" }],
        target: () => {
          attempt += 1;
          return attempt === 1 ? "ok" : "bad";
        },
        metrics: [exactMatch()],
        trials: 3,
      });

      expect(result.passed).toBe(false);
      expect(result.results[0]?.outcome).toBe("fail");
      expect(result.results[0]?.output).toBe("bad");
      expect(result.results[0]?.trials?.passAtK).toBe(true);
      expect(result.results[0]?.trials?.passAllK).toBe(false);
    });

    it("reuses cached target outputs with memory and file caches", async () => {
      const memoryCache = createMemoryEvalCache<string, string>();
      let calls = 0;
      const target = (input: string) => {
        calls += 1;
        return input.toUpperCase();
      };

      const first = await runEvalSuite({
        name: "cached-run",
        cases: [{ id: "a", input: "hello", expected: "HELLO" }],
        target,
        metrics: [exactMatch()],
        targetCache: memoryCache,
      });
      const second = await runEvalSuite({
        name: "cached-run",
        cases: [{ id: "a", input: "hello", expected: "HELLO" }],
        target,
        metrics: [exactMatch()],
        targetCache: memoryCache,
      });

      expect(calls).toBe(1);
      expect(first.results[0]?.cached).toBeUndefined();
      expect(second.results[0]?.cached).toBe(true);
      expect(second.passed).toBe(true);
      expect(memoryCache.size).toBe(1);

      const billingCache = createMemoryEvalCache<string, { output: string; usage: Usage }>();
      let billingCalls = 0;
      const billedTarget = (input: string) => {
        billingCalls += 1;
        return {
          output: input.toUpperCase(),
          usage: { ...Usage.empty(), inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      };
      const billingOptions = {
        name: "cached-billing",
        cases: [{ id: "b1", input: "hello", expected: "HELLO" }],
        target: billedTarget,
        metrics: [exactMatch(), maxTokens(20)],
        targetCache: billingCache,
        cost: {
          currency: "USD",
          calculate: ({ usage }: { usage: Usage }) => usage.totalTokens * 0.01,
        },
      };
      const firstBilled = await runEvalSuite(billingOptions);
      const cachedBilled = await runEvalSuite(billingOptions);
      expect(billingCalls).toBe(1);
      expect(firstBilled.usage.target.totalTokens).toBe(15);
      expect(firstBilled.cost?.target).toBe(0.15);
      expect(cachedBilled.passed).toBe(true);
      expect(cachedBilled.results[0]?.cached).toBe(true);
      expect(cachedBilled.usage.target.totalTokens).toBe(0);
      expect(cachedBilled.cost?.target).toBe(0);
      expect(cachedBilled.results[0]?.scores.max_tokens?.score).toBe(15);

      const wrapped = cachedEvalTarget(target, memoryCache);
      expect(await wrapped("hello", { id: "a", input: "hello" })).toBe("HELLO");
      expect(calls).toBe(1);

      const trialCache = createMemoryEvalCache<string, string>();
      let trialTargetCalls = 0;
      const wrappedMultiTrial = cachedEvalTarget((_input: string, _testCase, context) => {
        trialTargetCalls += 1;
        return `trial-${context?.trial ?? 0}`;
      }, trialCache);
      await trialCache.set(
        't1::trial=1::"q"',
        { output: "trial-1", targetDurationMs: 250, cachedAt: new Date().toISOString() },
        { id: "t1", input: "q" },
      );
      const wrappedSuite = await runEvalSuite({
        name: "wrapped-multi-trial",
        cases: [{ id: "t1", input: "q" }],
        target: wrappedMultiTrial,
        metrics: [maxDurationMs(100)],
        trials: { count: 2, minPassRate: 0.5 },
      });
      expect(trialTargetCalls).toBe(1);
      expect(wrappedSuite.results[0]?.trials?.runs[0]?.cached).toBe(true);
      expect(wrappedSuite.results[0]?.trials?.runs[0]?.output).toBe("trial-1");
      expect(wrappedSuite.results[0]?.trials?.runs[0]?.outcome).toBe("fail");
      expect(wrappedSuite.results[0]?.trials?.runs[1]?.cached).toBeUndefined();
      expect(wrappedSuite.results[0]?.trials?.runs[1]?.output).toBe("trial-2");
      expect(wrappedSuite.results[0]?.trials?.runs[1]?.outcome).toBe("pass");

      const failingCache = {
        get: async () => {
          throw new Error("cache read unavailable");
        },
        set: async () => {
          throw new Error("disk full");
        },
      };
      const resilient = await runEvalSuite({
        name: "resilient-cache",
        cases: [{ id: "a", input: "hello", expected: "HELLO" }],
        target: (input) => input.toUpperCase(),
        metrics: [exactMatch()],
        targetCache: failingCache,
      });
      expect(resilient.passed).toBe(true);
      expect(resilient.results[0]?.targetStatus).toBe("succeeded");
      expect(resilient.results[0]?.output).toBe("HELLO");

      const dir = await mkdtemp(join(tmpdir(), "anvia-eval-cache-"));
      try {
        const cachePath = join(dir, "cache.json");
        let fileCalls = 0;
        const fileTarget = (input: string) => {
          fileCalls += 1;
          return `${input}!`;
        };
        await runEvalSuite({
          name: "file-cache",
          cases: [{ id: "x", input: "hi", expected: "hi!" }],
          target: fileTarget,
          metrics: [exactMatch()],
          targetCache: createFileEvalCache(cachePath),
        });
        const reloaded = await runEvalSuite({
          name: "file-cache",
          cases: [{ id: "x", input: "hi", expected: "hi!" }],
          target: fileTarget,
          metrics: [exactMatch()],
          targetCache: createFileEvalCache(cachePath),
        });
        expect(fileCalls).toBe(1);
        expect(reloaded.results[0]?.cached).toBe(true);
        expect(reloaded.passed).toBe(true);

        const { mkdir } = await import("node:fs/promises");
        const recoverablePath = join(dir, "recoverable-cache.json");
        const recoverableCache = createFileEvalCache<string, string>(recoverablePath);
        expect(await recoverableCache.get("missing", { id: "c0", input: "i0" })).toBeUndefined();
        await mkdir(recoverablePath, { recursive: true });
        await expect(
          recoverableCache.set(
            "k1",
            { output: "v1", targetDurationMs: 1, cachedAt: new Date().toISOString() },
            { id: "c1", input: "i1" },
          ),
        ).rejects.toThrow();
        await rm(recoverablePath, { recursive: true, force: true });
        await recoverableCache.set(
          "k2",
          { output: "v2", targetDurationMs: 2, cachedAt: new Date().toISOString() },
          { id: "c2", input: "i2" },
        );
        const recovered = createFileEvalCache<string, string>(recoverablePath);
        expect((await recovered.get("k2", { id: "c2", input: "i2" }))?.output).toBe("v2");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("agentEvalTarget, metric shorthands, and agent metrics", () => {
    it("supports agentEvalTarget(agent) shorthand and default string prompt requests", async () => {
      const searchTool = createTool({
        name: "search_policy",
        description: "Search support policies",
        inputSchema: z.object({ topic: z.string() }),
        execute: ({ topic }) => `Policy for ${topic}: 30 days refund.`,
      });
      const model = new QueueModel([
        completion([AssistantContent.toolCall("tc1", "search_policy", { topic: "refund" })]),
        completion([AssistantContent.text("Refunds are available for 30 days.")]),
      ]);
      const agent = new Agent({
        id: "support",
        model,
        tools: [searchTool],
      });

      const typed = createEvalTypes<string, AgentResponse, string>();
      const result = await runEvalSuite({
        name: "agent-dx",
        cases: [{ id: "refund", input: "What is the refund policy?", expected: "30 days" }],
        target: agentEvalTarget(agent),
        metrics: [
          notBlank(),
          contains("30 days"),
          contains("REFUNDS", { name: "contains_ci", caseSensitive: false }),
          notContains("90 days"),
          toolCalled("search_policy", { args: { topic: "refund" }, minCalls: 1, maxCalls: 1 }),
          toolNotCalled("delete_account"),
          toolCallOrder(["search_policy"], { strict: true }),
          maxTurns(2),
          maxTokens(100),
          maxDurationMs(5000),
          typed.predicate("starts_with_refund", ({ output }) => ({
            pass: output.output.startsWith("Refunds"),
            comment: "Should start directly with policy.",
          })),
          predicate<string, AgentResponse, string>("direct_predicate", ({ output }) =>
            output.output.includes("30 days"),
          ),
        ],
      });

      assertEvalPassed(result);
      expect(result.passed).toBe(true);
      expect(result.metrics.passed).toBe(12);
    });

    it("supports positional shorthands, case-insensitive/trim exactMatch, schemaMatch, and zero-arg list/regex metrics", async () => {
      const schema = z.object({ status: z.enum(["ok", "error"]), count: z.number() });
      const result = await runEvalSuite({
        name: "shorthands",
        cases: [{ id: "c1", input: "  Hello World  ", expected: "hello world" }],
        target: (input) => input,
        metrics: [
          exactMatch({ caseSensitive: false, trim: true }),
          containsAll(["hello", "world"], { caseSensitive: false }),
          containsAny(["missing", "WORLD"], { caseSensitive: false }),
          matches(/hello/i),
          doesNotMatch(/forbidden/),
          maxLength(20),
          requiredFields(["status"], { actual: () => ({ status: "ok", count: 2 }) }),
          schemaMatch(schema, { actual: () => ({ status: "ok", count: 2 }) }),
          schemaMatch(schema, {
            name: "schema_json",
            parseJson: true,
            actual: () => '{"status":"ok","count":3}',
          }),
        ],
      });

      assertEvalPassed(result);
      expect(result.metrics.passed).toBe(9);

      const implicitList = await runEvalSuite({
        name: "implicit-zero-arg",
        cases: [{ id: "c1", input: "alpha beta", expected: ["alpha", "beta"] }],
        target: (input) => input,
        metrics: [containsAll(), containsAny()],
      });
      expect(implicitList.passed).toBe(true);

      const implicitRegex = await runEvalSuite({
        name: "implicit-regex",
        cases: [{ id: "c1", input: "order-42", expected: /^order-\d+$/ }],
        target: (input) => input,
        metrics: [matches()],
      });
      expect(implicitRegex.passed).toBe(true);
    });
  });

  describe("LLM judge ergonomics", () => {
    it("skips maybeReason on passing cases when includeReason is on-fail", async () => {
      const passingModel = new QueueModel([
        judgeResponse({ statements: ["Refunds last 30 days."] }),
        judgeResponse({ verdicts: [{ verdict: "yes", reason: "relevant" }] }),
      ]);
      const passing = await runEvalSuite({
        name: "on-fail-pass",
        cases: [{ id: "c1", input: "Refund policy?" }],
        target: () => "Refunds last 30 days.",
        metrics: [
          answerRelevancy({ model: passingModel, threshold: 0.8, includeReason: "on-fail" }),
        ],
      });

      expect(passing.passed).toBe(true);
      expect(passingModel.requests).toHaveLength(2);
      expect(passing.results[0]?.scores.answer_relevancy?.comment).toBeUndefined();

      const failingModel = new QueueModel([
        judgeResponse({ statements: ["The weather is sunny."] }),
        judgeResponse({ verdicts: [{ verdict: "no", reason: "unrelated" }] }),
        judgeResponse({ reason: "Answer talks about weather instead of refunds." }),
      ]);
      const failing = await runEvalSuite({
        name: "on-fail-fail",
        cases: [{ id: "c1", input: "Refund policy?" }],
        target: () => "The weather is sunny.",
        metrics: [
          answerRelevancy({ model: failingModel, threshold: 0.8, includeReason: "on-fail" }),
        ],
      });

      expect(failing.passed).toBe(false);
      expect(failingModel.requests).toHaveLength(3);
      expect(failing.results[0]?.scores.answer_relevancy?.comment).toBe(
        "Answer talks about weather instead of refunds.",
      );
    });

    it("binds shared model and defaults via createJudgeMetrics", async () => {
      const model = new QueueModel([
        judgeResponse({ statements: ["Refunds last 30 days."] }),
        judgeResponse({ verdicts: [{ verdict: "yes", reason: "relevant" }] }),
        judgeResponse({ score: 0.9, feedback: "Accurate and concise." }),
      ]);
      const judge = createJudgeMetrics({ model, includeReason: "on-fail" });

      const result = await runEvalSuite({
        name: "judge-factory",
        cases: [{ id: "c1", input: "Refund policy?", expected: "30 days" }],
        target: () => "Refunds last 30 days.",
        metrics: [
          judge.answerRelevancy({ threshold: 0.8 }),
          judge.llmScore({ threshold: 0.8, criteria: "Matches policy." }),
        ],
      });

      assertEvalPassed(result);
      expect(model.requests).toHaveLength(3);
    });
  });

  describe("CLI args, assertions, comparisons, target matrix, and dataset loaders", () => {
    it("parses CLI flags and applies them in runEvalCli", async () => {
      const parsed = parseEvalCliArgs([
        "--format",
        "pretty",
        "--case",
        "a,b",
        "--tag",
        "smoke",
        "--concurrency=2",
        "--timeout",
        "5000",
        "--trials",
        "2",
        "--shard",
        "0/2",
        "--failed-only",
        "--no-color",
        "--progress",
        "--score-tolerance",
        "0.05",
      ]);
      expect(parsed).toEqual({
        format: "pretty",
        caseIds: ["a", "b"],
        tags: ["smoke"],
        concurrency: 2,
        caseTimeoutMs: 5000,
        trials: 2,
        shard: { index: 0, count: 2 },
        onlyFailures: true,
        color: false,
        progress: true,
        scoreTolerance: 0.05,
      });

      let stdout = "";
      let stderr = "";
      const result = await runEvalCli({
        name: "cli-flags",
        cases: [
          { id: "pass", input: "ok", expected: "ok", tags: ["smoke"] },
          { id: "fail", input: "bad", expected: "ok", tags: ["smoke"] },
          { id: "other", input: "skip", expected: "skip", tags: ["slow"] },
        ],
        target: (input) => input,
        metrics: [exactMatch()],
        argv: ["--tag", "smoke", "--failed-only", "--progress"],
        output: {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
        },
      });

      expect(result.results.map((entry) => entry.case.id)).toEqual(["pass", "fail"]);
      expect(stdout).toContain("Metric summary:");
      expect(stdout).toContain("[FAIL] fail");
      expect(stdout).toContain("input: bad");
      expect(stdout).not.toContain("[PASS] pass");
      expect(stderr).toContain("[1/2]");
      expect(stderr).toContain("[2/2]");

      const formattedColor = formatEvalResult(result, { color: true });
      expect(formattedColor).toContain("\u001B[31mFAIL\u001B[0m");
    });

    it("throws EvalAssertionError with failure details from assertEvalPassed", async () => {
      const result = await runEvalSuite({
        name: "failing-suite",
        cases: [{ id: "c1", input: "wrong", expected: "right" }],
        target: (input) => input,
        metrics: [exactMatch()],
      });

      expect(() => assertEvalPassed(result)).toThrow(EvalAssertionError);
      expect(() => assertEvalPassed(result)).toThrow(/c1\.exact_match: fail/);
    });

    it("compares baseline vs candidate results, persists snapshots, and runs compareEvalTargets", async () => {
      const dir = await mkdtemp(join(tmpdir(), "anvia-eval-compare-"));
      try {
        const baselinePath = join(dir, "baseline.json");
        const baseline = await runEvalSuite({
          name: "support",
          cases: [
            { id: "c1", input: "good", expected: "good" },
            { id: "c2", input: "bad", expected: "good" },
          ],
          target: (input) => input,
          metrics: [exactMatch()],
        });
        await saveEvalResult(baselinePath, baseline);
        const loaded = await loadEvalResult(baselinePath);

        const candidate = await runEvalSuite({
          name: "support",
          cases: [
            { id: "c1", input: "regressed", expected: "good" },
            { id: "c2", input: "good", expected: "good" },
            { id: "c3", input: "new", expected: "new" },
          ],
          target: (input) => input,
          metrics: [exactMatch()],
        });

        const diff = compareEvalResults(loaded, candidate);
        expect(diff.hasRegressions).toBe(true);
        expect(diff.regressions.map((item) => item.caseId)).toEqual(["c1"]);
        expect(diff.improvements.map((item) => item.caseId)).toEqual(["c2"]);
        expect(diff.addedCases).toEqual(["c3"]);
        expect(formatEvalComparison(diff)).toContain("1 regression(s) / 1 improvement(s)");

        const droppedCase = await runEvalSuite({
          name: "support",
          cases: [{ id: "c1", input: "good", expected: "good" }],
          target: (input) => input,
          metrics: [notBlank()],
        });
        const droppedDiff = compareEvalResults(loaded, droppedCase);
        expect(droppedDiff.hasRegressions).toBe(true);
        expect(droppedDiff.removedCases).toEqual(["c2"]);
        expect(droppedDiff.missingMetrics).toEqual([
          { caseId: "c1", metricName: "exact_match", baselineOutcome: "pass" },
        ]);
        expect(
          compareEvalResults(loaded, droppedCase, {
            ignoreRemovedCases: true,
            ignoreMissingMetrics: true,
          }).hasRegressions,
        ).toBe(false);

        const samePath = join(dir, "rolling-baseline.json");
        await saveEvalResult(samePath, loaded);
        let cliOut = "";
        await runEvalCli({
          name: "support",
          cases: [
            { id: "c1", input: "regressed", expected: "good" },
            { id: "c2", input: "good", expected: "good" },
          ],
          target: (input) => input,
          metrics: [exactMatch()],
          argv: ["--baseline", samePath, "--save", samePath],
          output: {
            stdout: (text) => {
              cliOut += text;
            },
          },
        });
        expect(cliOut).toContain("1 regression(s) / 1 improvement(s)");
        const updatedSnapshot = await loadEvalResult(samePath);
        expect(updatedSnapshot.results[0]?.output).toBe("regressed");

        const bootstrapPath = join(dir, "bootstrap-baseline.json");
        let bootstrapErr = "";
        await runEvalCli({
          name: "support",
          cases: [{ id: "c1", input: "secret-token", expected: "secret-token" }],
          target: (input) => input,
          metrics: [exactMatch()],
          trials: 2,
          redact: (value, ctx) =>
            ctx.kind === "input" || ctx.kind === "output" ? "[REDACTED]" : value,
          argv: ["--baseline", bootstrapPath, "--save", bootstrapPath],
          output: {
            stdout: () => {},
            stderr: (text) => {
              bootstrapErr += text;
            },
          },
        });
        expect(bootstrapErr).toContain("Baseline file not found");
        const bootstrapped = await loadEvalResult(bootstrapPath);
        expect(bootstrapped.results[0]?.case.input).toBe("[REDACTED]");
        expect(bootstrapped.results[0]?.output).toBe("[REDACTED]");
        expect(bootstrapped.results[0]?.trials?.runs[0]?.output).toBe("[REDACTED]");

        const fullBaselinePath = join(dir, "full-baseline.json");
        const fullBaseline = await runEvalSuite({
          name: "subset-check",
          cases: [
            { id: "c1", input: "ok", expected: "ok", tags: ["smoke"] },
            { id: "c2", input: "ok", expected: "ok", tags: ["slow"] },
          ],
          target: (input) => input,
          metrics: [
            {
              name: "score",
              dataType: "NUMERIC",
              threshold: 0.7,
              evaluate: () => EvalOutcome.pass(0.9),
            },
          ],
        });
        await saveEvalResult(fullBaselinePath, fullBaseline);

        const prevExitCode = process.exitCode;
        process.exitCode = 0;
        try {
          await runEvalCli({
            name: "subset-check",
            cases: [
              { id: "c1", input: "ok", expected: "ok", tags: ["smoke"] },
              { id: "c2", input: "ok", expected: "ok", tags: ["slow"] },
            ],
            target: (input) => input,
            metrics: [
              {
                name: "score",
                dataType: "NUMERIC",
                threshold: 0.7,
                evaluate: () => EvalOutcome.pass(0.88),
              },
            ],
            exitCode: true,
            argv: ["--tag", "smoke", "--baseline", fullBaselinePath, "--score-tolerance", "0.05"],
            output: { stdout: () => {} },
          });
          expect(process.exitCode).toBe(0);
        } finally {
          process.exitCode = prevExitCode;
        }

        const invalidSnapshotPath = join(dir, "invalid-snapshot.json");
        const savedAfterInvalidPath = join(dir, "saved-after-invalid.json");
        await writeFile(
          invalidSnapshotPath,
          JSON.stringify({ name: "broken", results: [] }),
          "utf8",
        );
        await expect(loadEvalResult(invalidSnapshotPath)).rejects.toThrow(TypeError);
        await expect(
          runEvalCli({
            name: "support",
            cases: [{ id: "c1", input: "ok", expected: "ok" }],
            target: (input) => input,
            metrics: [exactMatch()],
            argv: ["--baseline", invalidSnapshotPath, "--save", savedAfterInvalidPath],
            output: { stdout: () => {} },
          }),
        ).rejects.toThrow(TypeError);
        const savedAfterInvalid = await loadEvalResult(savedAfterInvalidPath);
        expect(savedAfterInvalid.results[0]?.output).toBe("ok");

        const sharedTargetCache = createMemoryEvalCache<string, string>();
        let v1Calls = 0;
        let v2Calls = 0;
        const matrix = await compareEvalTargets({
          name: "prompt-ab",
          cases: [{ id: "c1", input: "hello", expected: "HELLO" }],
          targets: {
            v1: (input) => {
              v1Calls += 1;
              return input;
            },
            v2: (input) => {
              v2Calls += 1;
              return input.toUpperCase();
            },
          },
          metrics: [exactMatch()],
          targetCache: sharedTargetCache,
        });
        expect(v1Calls).toBe(1);
        expect(v2Calls).toBe(1);
        expect(matrix.baselineTarget).toBe("v1");
        expect(matrix.results.v1?.passed).toBe(false);
        expect(matrix.results.v2?.passed).toBe(true);
        expect(matrix.comparisons.v2?.improvements).toHaveLength(1);
        expect(matrix.comparisons.v2?.hasRegressions).toBe(false);

        const cachedMatrix = await compareEvalTargets({
          name: "prompt-ab",
          cases: [{ id: "c1", input: "hello", expected: "HELLO" }],
          targets: {
            v1: (input) => {
              v1Calls += 1;
              return input;
            },
            v2: (input) => {
              v2Calls += 1;
              return input.toUpperCase();
            },
          },
          metrics: [exactMatch()],
          targetCache: sharedTargetCache,
        });
        expect(v1Calls).toBe(1);
        expect(v2Calls).toBe(1);
        expect(cachedMatrix.results.v1?.results[0]?.cached).toBe(true);
        expect(cachedMatrix.results.v2?.results[0]?.cached).toBe(true);
        expect(cachedMatrix.results.v1?.results[0]?.output).toBe("hello");
        expect(cachedMatrix.results.v2?.results[0]?.output).toBe("HELLO");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("loads JSON and JSONL datasets with optional autoId and Zod validation", async () => {
      const dir = await mkdtemp(join(tmpdir(), "anvia-eval-dataset-"));
      try {
        const jsonlPath = join(dir, "cases.jsonl");
        await writeFile(
          jsonlPath,
          [
            JSON.stringify({ input: "q1", expected: "a1", tags: ["smoke"] }),
            JSON.stringify({ id: "custom-2", input: "q2", expected: "a2" }),
          ].join("\n"),
          "utf8",
        );

        const cases = await loadEvalCases(jsonlPath, {
          autoId: true,
          schema: z.object({
            id: z.string(),
            input: z.string(),
            expected: z.string(),
            tags: z.array(z.string()).optional(),
          }),
        });

        expect(cases).toEqual([
          { id: "case-1", input: "q1", expected: "a1", tags: ["smoke"] },
          { id: "custom-2", input: "q2", expected: "a2" },
        ]);

        const jsonPath = join(dir, "cases.json");
        await writeFile(
          jsonPath,
          JSON.stringify({ cases: [{ id: "j1", input: "hello", expected: "hello" }] }),
          "utf8",
        );
        const jsonCases = await loadEvalCases<string, string>(jsonPath);
        expect(jsonCases).toEqual([{ id: "j1", input: "hello", expected: "hello" }]);

        const collisionPath = join(dir, "collision.json");
        await writeFile(
          collisionPath,
          JSON.stringify([
            { input: "auto-first" },
            { id: "case-1", input: "explicit-case-1" },
            { input: "auto-second" },
          ]),
          "utf8",
        );
        const collisionCases = await loadEvalCases<string>(collisionPath, { autoId: true });
        expect(collisionCases.map((entry) => entry.id)).toEqual(["case-2", "case-1", "case-3"]);

        const duplicatePath = join(dir, "duplicate.json");
        await writeFile(
          duplicatePath,
          JSON.stringify([
            { id: "dup", input: "a" },
            { id: "dup", input: "b" },
          ]),
          "utf8",
        );
        await expect(loadEvalCases(duplicatePath)).rejects.toThrow(/Duplicate eval case id "dup"/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
