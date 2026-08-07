import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  AssistantContent,
  agentEvalTarget,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  contains,
  containsAll,
  containsAny,
  defineMetric,
  doesNotMatch,
  type Embedding,
  type EmbeddingModel,
  type EvalMetricArgs,
  EvalOutcome,
  exactMatch,
  llmJudge,
  llmScore,
  matches,
  maxLength,
  notContains,
  projectEvalOutcome,
  requiredFields,
  resolveEvalTraceRef,
  runEvalSuite,
  semanticSimilarity,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

class KeywordEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({ document, vector: vectorFor(document) }));
  }
}

describe("evals", () => {
  it("runs deterministic metrics and counts outcomes", async () => {
    const result = await runEvalSuite({
      name: "deterministic",
      cases: [
        { id: "pass", input: "hello", expected: "HELLO" },
        { id: "fail", input: "bye", expected: "HELLO" },
      ],
      target: async (input) => input.toUpperCase(),
      metrics: [exactMatch()],
    });

    expect(result.metrics.passed).toBe(1);
    expect(result.metrics.failed).toBe(1);
    expect(result.metrics.invalid).toBe(0);
    expect(result.results.map((caseResult) => caseResult.case.id)).toEqual(["pass", "fail"]);
    expect(result.results[0]?.metrics[0]?.outcome.outcome).toBe("pass");
    expect(result.results[1]?.metrics[0]?.outcome.outcome).toBe("fail");
  });

  it("preserves result order with concurrent targets", async () => {
    const result = await runEvalSuite({
      name: "concurrent",
      cases: [
        { id: "slow", input: 20, expected: 20 },
        { id: "fast", input: 1, expected: 1 },
      ],
      target: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, input));
        return input;
      },
      metrics: [exactMatch()],
      concurrency: 2,
    });

    expect(result.results.map((caseResult) => caseResult.case.id)).toEqual(["slow", "fast"]);
  });

  it("turns target errors into invalid metric results", async () => {
    const result = await runEvalSuite({
      name: "target-error",
      cases: [{ id: "broken", input: "x", expected: "x" }],
      target: async () => {
        throw new Error("boom");
      },
      metrics: [exactMatch(), contains()],
    });

    expect(result.metrics.invalid).toBe(2);
    expect(result.results[0]?.targetError).toBeInstanceOf(Error);
    expect(result.results[0]?.metrics.map((metric) => metric.outcome.outcome)).toEqual([
      "invalid",
      "invalid",
    ]);
  });

  it("supports exact and contains selector functions", async () => {
    const result = await runEvalSuite({
      name: "selectors",
      cases: [
        {
          id: "selector",
          input: { text: "Alpha beta" },
          expected: { exact: "Alpha beta", part: "beta" },
        },
      ],
      target: async (input) => ({ text: input.text, tokens: input.text.split(" ") }),
      metrics: [
        exactMatch<
          { text: string },
          { text: string; tokens: string[] },
          { exact: string; part: string }
        >({
          actual: ({ output }) => output.text,
          expected: (
            args: EvalMetricArgs<
              { text: string },
              { text: string; tokens: string[] },
              { exact: string; part: string }
            >,
          ) => args.case.expected?.exact,
        }),
        contains<
          { text: string },
          { text: string; tokens: string[] },
          { exact: string; part: string }
        >({
          actual: ({ output }) => output.tokens.join("|"),
          expected: (args) => args.case.expected?.part ?? "",
        }),
      ],
    });

    expect(result.metrics.passed).toBe(2);
  });

  it("keeps contains regex expectations deterministic across cases", async () => {
    const globalPattern = /beta/g;
    const stickyPattern = /beta/y;
    const result = await runEvalSuite({
      name: "regex-contains",
      cases: [
        { id: "first", input: "beta" },
        { id: "second", input: "beta" },
      ],
      target: async (input) => input,
      metrics: [
        contains({ name: "contains_global", expected: globalPattern }),
        contains({ name: "contains_sticky", expected: stickyPattern }),
      ],
    });

    expect(result.metrics.passed).toBe(4);
    expect(result.metrics.failed).toBe(0);
    expect(globalPattern.lastIndex).toBe(0);
    expect(stickyPattern.lastIndex).toBe(0);
  });

  it("scores semantic similarity with an embedding model", async () => {
    const result = await runEvalSuite({
      name: "semantic",
      cases: [{ id: "cat", input: "cat", expected: "pet" }],
      target: async () => "cat",
      metrics: [semanticSimilarity({ model: new KeywordEmbeddingModel(), threshold: 0.9 })],
    });

    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "pass",
      score: 1,
    });
  });

  it("runs LLM judge and LLM score metrics through ExtractorBuilder", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("judge", "submit", { passed: true, reason: "ok" })]),
      response([AssistantContent.toolCall("score", "submit", { score: 0.8, feedback: "good" })]),
    ]);
    const result = await runEvalSuite({
      name: "llm",
      cases: [{ id: "case", input: "answer", expected: "answer" }],
      target: async () => "answer",
      metrics: [
        llmJudge({
          model,
          schema: z.object({ passed: z.boolean(), reason: z.string() }),
          passes: (judgment) => judgment.passed,
        }),
        llmScore({
          model,
          threshold: 0.7,
          criteria: "The answer should match the expected value.",
        }),
      ],
    });

    expect(result.metrics.passed).toBe(2);
    expect(model.requests).toHaveLength(2);
  });

  it("wraps agents as eval targets and preserves prompt trace output", async () => {
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new AgentBuilder("agent", model).build();
    const target = agentEvalTarget<string>(agent);

    const output = await target("hello", { id: "case", input: "hello" });

    expect(output.output).toBe("ok");
    expect(model.requests[0]?.chatHistory).toMatchObject([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("captures reporter errors without failing by default", async () => {
    const result = await runEvalSuite({
      name: "reporters",
      cases: [{ id: "case", input: "x", expected: "x" }],
      target: async (input) => input,
      metrics: [exactMatch()],
      reporters: [
        {
          report: async () => {
            throw new Error("report failed");
          },
        },
      ],
    });

    expect(result.metrics.passed).toBe(1);
    expect(result.results[0]?.metrics[0]?.reporterErrors).toHaveLength(1);
  });

  it("propagates one evaluation run through lifecycle hooks and reports", async () => {
    const events: Array<{ type: string; id: string; status?: string }> = [];
    const result = await runEvalSuite({
      name: "release-gate",
      run: {
        id: "run-1",
        datasetName: "support-cases",
        datasetVersion: "v2",
        metadata: { commitSha: "abc123" },
      },
      cases: [{ id: "case", input: "x", expected: "x" }],
      target: async (input) => input,
      metrics: [exactMatch()],
      reporters: [
        {
          onRunStart: ({ run }) => {
            events.push({ type: "start", id: run.id });
          },
          report: ({ run }) => {
            events.push({ type: "result", id: run?.id ?? "missing" });
          },
          onRunEnd: ({ run, status }) => {
            events.push({ type: "end", id: run.id, status });
          },
        },
      ],
    });

    expect(events).toEqual([
      { type: "start", id: "run-1" },
      { type: "result", id: "run-1" },
      { type: "end", id: "run-1", status: "completed" },
    ]);
    expect(result.run).toMatchObject({
      id: "run-1",
      datasetName: "support-cases",
      datasetVersion: "v2",
      metadata: { commitSha: "abc123" },
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(result.reporterErrors).toEqual([]);
  });

  it("finishes the evaluation run as failed when strict reporting aborts", async () => {
    const statuses: string[] = [];
    await expect(
      runEvalSuite({
        name: "strict-run",
        cases: [{ id: "case", input: "x", expected: "x" }],
        target: async (input) => input,
        metrics: [exactMatch()],
        reporters: [
          {
            report: () => {
              throw new Error("publish failed");
            },
            onRunEnd: ({ status }) => {
              statuses.push(status);
            },
          },
        ],
        failOnReporterError: true,
      }),
    ).rejects.toThrow("publish failed");
    expect(statuses).toEqual(["failed"]);
  });

  it("waits for active reporters before ending a failed concurrent run", async () => {
    const events: string[] = [];
    let markActiveStarted: () => void = () => {};
    const activeStarted = new Promise<void>((resolve) => {
      markActiveStarted = resolve;
    });
    const suite = runEvalSuite({
      name: "strict-concurrent-run",
      cases: [
        { id: "failure", input: "failure", expected: "failure" },
        { id: "active", input: "active", expected: "active" },
        { id: "not-started", input: "not-started", expected: "not-started" },
      ],
      target: async (input) => input,
      metrics: [exactMatch()],
      reporters: [
        {
          report: async ({ case: testCase }) => {
            if (testCase.id === "failure") {
              await activeStarted;
              events.push("failure");
              throw new Error("publish failed");
            }
            if (testCase.id === "active") {
              events.push("active-start");
              markActiveStarted();
              await new Promise((resolve) => setTimeout(resolve, 20));
              events.push("active-end");
              return;
            }
            events.push("late-result");
          },
          onRunEnd: () => {
            events.push("run-end");
          },
        },
      ],
      concurrency: 2,
      failOnReporterError: true,
    });

    await expect(suite).rejects.toThrow("publish failed");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual(["active-start", "failure", "active-end", "run-end"]);
  });

  it("resolves default and selected trace references for reporters", async () => {
    expect(
      resolveEvalTraceRef({
        output: { trace: { traceId: "output-trace", observationId: "output-observation" } },
        input: { trace: { traceId: "input-trace" } },
      }),
    ).toEqual({ traceId: "output-trace", observationId: "output-observation" });

    const traces: unknown[] = [];
    await runEvalSuite({
      name: "trace-selector",
      cases: [{ id: "case", input: "x", expected: "x" }],
      target: async (input) => input,
      metrics: [exactMatch()],
      trace: () => ({
        traceId: "selected-trace",
        observationId: "selected-observation",
        responseId: "response-1",
      }),
      reporters: [
        {
          report: (args) => {
            traces.push(args.trace);
          },
        },
      ],
    });

    expect(traces).toEqual([
      {
        traceId: "selected-trace",
        observationId: "selected-observation",
        responseId: "response-1",
      },
    ]);
  });

  it("captures trace selector errors without requiring a reporter", async () => {
    const result = await runEvalSuite({
      name: "trace-selector-error",
      cases: [{ id: "case", input: "x", expected: "x" }],
      target: async (input) => input,
      metrics: [exactMatch()],
      trace: () => {
        throw new Error("trace selection failed");
      },
    });

    expect(result.results[0]?.metrics[0]?.reporterErrors).toEqual([
      expect.objectContaining({ message: "trace selection failed" }),
    ]);
  });

  it("throws trace selector errors without reporters when failOnReporterError is enabled", async () => {
    await expect(
      runEvalSuite({
        name: "trace-selector-error-strict",
        cases: [{ id: "case", input: "x", expected: "x" }],
        target: async (input) => input,
        metrics: [exactMatch()],
        trace: () => {
          throw new Error("strict trace selection failed");
        },
        failOnReporterError: true,
      }),
    ).rejects.toThrow("strict trace selection failed");
  });

  it("supports custom metrics that return invalid outcomes", async () => {
    const result = await runEvalSuite({
      name: "custom-invalid",
      cases: [{ id: "case", input: "x" }],
      target: async (input) => input,
      metrics: [
        {
          name: "custom",
          evaluate: () => EvalOutcome.invalid("missing expectation"),
        },
      ],
    });

    expect(result.metrics.invalid).toBe(1);
  });

  it("exposes separate metric and case totals with required metric precedence", async () => {
    const result = await runEvalSuite({
      name: "totals",
      cases: [
        { id: "invalid", input: "invalid" },
        { id: "optional", input: "optional" },
      ],
      target: (input) => input,
      metrics: [
        {
          name: "quality",
          evaluate: ({ case: testCase }) =>
            testCase.id === "invalid" ? EvalOutcome.fail(false) : EvalOutcome.pass(true),
        },
        {
          name: "infrastructure",
          evaluate: ({ case: testCase }) =>
            testCase.id === "invalid"
              ? EvalOutcome.invalid("judge unavailable")
              : EvalOutcome.pass(true),
        },
        {
          name: "diagnostic",
          required: false,
          evaluate: () => EvalOutcome.fail(false),
        },
      ],
    });

    expect(result.metrics).toEqual({ total: 6, passed: 2, failed: 3, invalid: 1 });
    expect(result.cases).toEqual({ total: 2, passed: 1, failed: 0, invalid: 1 });
    expect(result.results.map((caseResult) => caseResult.outcome)).toEqual(["invalid", "pass"]);
  });

  it("runs the deterministic text, length, regex, and object metrics", async () => {
    const result = await runEvalSuite({
      name: "deterministic-builtins",
      cases: [{ id: "policy", input: "Refunds: 30 days with proof of purchase." }],
      target: (input) => input,
      metrics: [
        notContains({ expected: "internal-code-4821" }),
        containsAll({ expected: ["30 days", "proof of purchase"] }),
        containsAny({ expected: ["receipt", /proof/i] }),
        matches({ expected: /refunds?/i }),
        doesNotMatch({ expected: /workspace owners?/i }),
        maxLength({ max: 100 }),
        requiredFields({ actual: () => ({ answer: "ok", sources: [] }), expected: ["answer"] }),
      ],
    });

    expect(result.metrics).toEqual({ total: 7, passed: 7, failed: 0, invalid: 0 });
    expect(result.results[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: true,
          direction: "higher_is_better",
          threshold: 1,
        }),
      ]),
    );
  });

  it("aggregates target and evaluation usage and calculates caller-priced cost", async () => {
    const result = await runEvalSuite({
      name: "usage",
      cases: [{ id: "case", input: "hello" }],
      target: (input) => ({ output: input, usage: usage(3, 2) }),
      metrics: [
        {
          name: "judge",
          evaluate: () => EvalOutcome.pass(0.9, { usage: usage(4, 1) }),
        },
      ],
      cost: {
        currency: "USD",
        calculate: ({ kind, usage: measured }) =>
          measured.totalTokens * (kind === "target" ? 0.001 : 0.002),
      },
    });

    expect(result.usage.target.totalTokens).toBe(5);
    expect(result.usage.evaluation.totalTokens).toBe(5);
    expect(result.usage.total.totalTokens).toBe(10);
    expect(result.cost).toEqual({
      currency: "USD",
      target: 0.005,
      evaluation: 0.01,
      total: 0.015,
    });
  });

  it("rejects duplicate case ids and metric names before running targets", async () => {
    await expect(
      runEvalSuite({
        name: "duplicates",
        cases: [
          { id: "same", input: "a" },
          { id: "same", input: "b" },
        ],
        target: (input) => input,
        metrics: [exactMatch({ expected: "a" })],
      }),
    ).rejects.toThrow("Evaluation case id must be unique");
  });
});

describe("defineMetric", () => {
  it("returns the metric object unchanged and preserves annotations", async () => {
    const metric = defineMetric({
      name: "quality",
      dataType: "CATEGORICAL" as const,
      scoreConfigId: "sc-1",
      metadata: { suite: "qa" },
      evaluate: () => EvalOutcome.pass("good"),
    });

    expect(metric.name).toBe("quality");
    expect(metric.dataType).toBe("CATEGORICAL");
    expect(metric.scoreConfigId).toBe("sc-1");
    expect(metric.metadata).toEqual({ suite: "qa" });
    const args: EvalMetricArgs<string, string> = {
      suiteName: "qa",
      case: { id: "c", input: "x" },
      output: "x",
    };
    await expect(Promise.resolve(metric.evaluate(args))).resolves.toEqual({
      outcome: "pass",
      score: "good",
    });
  });
});

describe("eval score projection", () => {
  it("normalizes numeric, categorical, boolean, and structured scores", () => {
    expect(projectEvalOutcome(EvalOutcome.pass(0.8), "NUMERIC")).toMatchObject({
      value: 0.8,
      numericValue: 0.8,
      label: "pass",
    });
    expect(
      projectEvalOutcome(EvalOutcome.fail("incorrect", { comment: "Mismatch" }), "CATEGORICAL"),
    ).toMatchObject({
      value: "incorrect",
      categoricalValue: "incorrect",
      label: "incorrect",
      explanation: "Mismatch",
    });
    expect(projectEvalOutcome(EvalOutcome.pass(false), "BOOLEAN")).toMatchObject({ value: 0 });
    expect(projectEvalOutcome(EvalOutcome.pass({ score: 0.4 }), undefined)).toMatchObject({
      value: 0.4,
    });
    expect(projectEvalOutcome(EvalOutcome.invalid("broken"), undefined)).toMatchObject({
      value: 0,
      label: "invalid",
      explanation: "broken",
    });
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function vectorFor(text: string): number[] {
  if (text.includes("cat") || text.includes("pet")) {
    return [1, 0, 0];
  }
  return [0, 1, 0];
}
