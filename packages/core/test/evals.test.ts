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
  defineMetric,
  type Embedding,
  type EmbeddingModel,
  type EvalMetricArgs,
  EvalOutcome,
  exactMatch,
  llmJudge,
  llmScore,
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

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.invalid).toBe(0);
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

    expect(result.invalid).toBe(2);
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

    expect(result.passed).toBe(2);
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

    expect(result.passed).toBe(2);
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

    expect(result.passed).toBe(1);
    expect(result.results[0]?.metrics[0]?.reporterErrors).toHaveLength(1);
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

    expect(result.invalid).toBe(1);
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

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

function vectorFor(text: string): number[] {
  if (text.includes("cat") || text.includes("pet")) {
    return [1, 0, 0];
  }
  return [0, 1, 0];
}
