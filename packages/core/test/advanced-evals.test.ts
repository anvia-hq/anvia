import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  answerRelevancy,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  faithfulness,
  gEval,
  hallucination,
  jsonCorrectness,
  knowledgeRetention,
  Message,
  promptAlignment,
  runEvalSuite,
  summarization,
  turnRelevancy,
  Usage,
} from "./helpers/imports";

class QueueJudgeModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "judge";
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
    if (response === undefined) throw new Error("No queued judge response");
    return response;
  }
}

describe("advanced eval metrics", () => {
  it("scores answer relevancy and records a final reason with aggregate usage", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({ statements: ["Relevant", "Tangent", "Unclear"] }),
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "answers the question" },
          { verdict: "no", reason: "unrelated" },
          { verdict: "idk", reason: "ambiguous" },
        ],
      }),
      judgeResponse({ reason: "One statement is unrelated." }),
    ]);
    const result = await runEvalSuite({
      name: "answer-relevancy",
      cases: [{ id: "case", input: "Question" }],
      target: () => "Answer",
      metrics: [answerRelevancy({ model, threshold: 0.6 })],
    });

    const outcome = result.results[0]?.metrics[0]?.outcome;
    expect(outcome).toMatchObject({
      outcome: "pass",
      score: 2 / 3,
      comment: "One statement is unrelated.",
      metadata: {
        evaluation: {
          scoreDirection: "higher_is_better",
          threshold: 0.6,
          strictMode: false,
          usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6 },
        },
      },
    });
    expect(model.requests).toHaveLength(3);
  });

  it("scores prompt alignment and rejects mismatched judge verdict counts", async () => {
    const passingModel = new QueueJudgeModel([
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "uppercase" },
          { verdict: "no", reason: "too long" },
        ],
      }),
    ]);
    const passing = await runEvalSuite({
      name: "alignment",
      cases: [{ id: "case", input: "Say hello" }],
      target: () => "HELLO FROM ANVIA",
      metrics: [
        promptAlignment({
          model: passingModel,
          promptInstructions: ["Use uppercase", "Use one word"],
          threshold: 0.5,
          includeReason: false,
        }),
      ],
    });
    expect(passing.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "pass",
      score: 0.5,
    });

    const mismatchedModel = new QueueJudgeModel([
      judgeResponse({ verdicts: [{ verdict: "yes", reason: "uppercase" }] }),
    ]);
    const mismatched = await runEvalSuite({
      name: "alignment-invalid",
      cases: [{ id: "case", input: "Say hello" }],
      target: () => "HELLO",
      metrics: [
        promptAlignment({
          model: mismatchedModel,
          promptInstructions: ["Use uppercase", "Use one word"],
          includeReason: false,
        }),
      ],
    });
    expect(mismatched.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "invalid",
      reason: expect.stringContaining("did not match"),
    });
  });

  it("validates JSON deterministically and treats invalid JSON as a failed score", async () => {
    const schema = z.object({ name: z.string() });
    const result = await runEvalSuite({
      name: "json",
      cases: [
        { id: "valid", input: "valid" },
        { id: "wrong-schema", input: "wrong" },
        { id: "malformed", input: "malformed" },
      ],
      target: (input) => {
        if (input === "valid") return '{"name":"Anvia"}';
        if (input === "wrong") return '{"name":1}';
        return "{'name':'Anvia'}";
      },
      metrics: [jsonCorrectness({ schema })],
    });

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.invalid).toBe(0);
    expect(result.results[1]?.metrics[0]?.outcome).toMatchObject({ outcome: "fail", score: 0 });
  });

  it("scores hallucination as lower-is-better and reads context from EvalCase", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "supported" },
          { verdict: "no", reason: "contradicted" },
        ],
      }),
    ]);
    const result = await runEvalSuite({
      name: "hallucination",
      cases: [{ id: "case", input: "Question", context: ["Fact one", "Fact two"] }],
      target: () => "Answer",
      metrics: [hallucination({ model, threshold: 0.4, includeReason: false })],
    });

    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "fail",
      score: 0.5,
      metadata: {
        evaluation: { scoreDirection: "lower_is_better", threshold: 0.4, strictMode: false },
      },
    });
  });

  it("scores faithfulness and optionally penalizes ambiguous claims", async () => {
    const responses = () => [
      judgeResponse({ facts: ["Refunds last 30 days"] }),
      judgeResponse({ facts: ["Refunds last 30 days", "Receipts are optional"] }),
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "supported" },
          { verdict: "idk", reason: "not stated" },
        ],
      }),
    ];
    const base = {
      name: "faithfulness",
      cases: [
        {
          id: "case",
          input: "Can I get a refund?",
          retrievalContext: ["Refunds last 30 days"],
        },
      ],
      target: () => "Refunds last 30 days and receipts are optional.",
    };
    const lenient = await runEvalSuite({
      ...base,
      metrics: [faithfulness({ model: new QueueJudgeModel(responses()), includeReason: false })],
    });
    const strict = await runEvalSuite({
      ...base,
      metrics: [
        faithfulness({
          model: new QueueJudgeModel(responses()),
          penalizeAmbiguousClaims: true,
          threshold: 0.75,
          includeReason: false,
        }),
      ],
    });

    expect(lenient.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "pass", score: 1 });
    expect(strict.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "fail", score: 0.5 });
  });

  it("returns summarization alignment and coverage breakdowns", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({ facts: ["A", "B"] }),
      judgeResponse({ facts: ["A", "Invented"] }),
      judgeResponse({ answers: ["yes", "yes"] }),
      judgeResponse({ answers: ["yes", "no"] }),
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "supported" },
          { verdict: "no", reason: "invented" },
        ],
      }),
    ]);
    const result = await runEvalSuite({
      name: "summary",
      cases: [{ id: "case", input: "Source" }],
      target: () => "Summary",
      metrics: [
        summarization({
          model,
          assessmentQuestions: ["A?", "B?"],
          threshold: 0.5,
          includeReason: false,
        }),
      ],
    });

    const summaryOutcome = result.results[0]?.metrics[0]?.outcome;
    expect(
      summaryOutcome?.outcome,
      summaryOutcome?.outcome === "invalid" ? summaryOutcome.reason : undefined,
    ).toBe("pass");
    expect(summaryOutcome).toMatchObject({
      outcome: "pass",
      score: 0.5,
      metadata: {
        evaluation: {
          scoreBreakdown: { alignment: 0.5, coverage: 0.5 },
        },
      },
    });
  });

  it("runs G-Eval with criteria, caches generated steps, and normalizes scores", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({ steps: ["Compare expected and actual"] }),
      judgeResponse({ score: 8, reason: "Mostly correct" }),
      judgeResponse({ score: 4, reason: "Partly correct" }),
    ]);
    const result = await runEvalSuite({
      name: "g-eval",
      cases: [
        { id: "one", input: "Q1", expected: "A1" },
        { id: "two", input: "Q2", expected: "A2" },
      ],
      target: () => "Answer",
      metrics: [
        gEval({
          name: "correctness",
          model,
          criteria: "Compare actual and expected output.",
          evaluationParams: ["actualOutput", "expectedOutput"],
          threshold: 0.5,
        }),
      ],
      concurrency: 2,
    });

    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "pass", score: 0.8 });
    expect(result.results[1]?.metrics[0]?.outcome).toMatchObject({ outcome: "fail", score: 0.4 });
    expect(model.requests).toHaveLength(3);
  });

  it("scores turn relevancy from EvalTurn arrays and native PromptResponse messages", async () => {
    const turns = [
      { role: "user" as const, content: "My name is Ada" },
      { role: "assistant" as const, content: "Hello Ada" },
      { role: "user" as const, content: "What is my name?" },
      { role: "assistant" as const, content: "Your name is Ada" },
    ];
    const turnModel = new QueueJudgeModel([
      judgeResponse({ verdict: "yes", reason: "relevant" }),
      judgeResponse({ verdict: "no", reason: "ignored context" }),
    ]);
    const direct = await runEvalSuite({
      name: "turns",
      cases: [{ id: "case", input: "conversation" }],
      target: () => turns,
      metrics: [turnRelevancy({ model: turnModel, includeReason: false, threshold: 0.5 })],
    });
    expect(direct.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "pass", score: 0.5 });

    const messageModel = new QueueJudgeModel([
      judgeResponse({ verdict: "yes", reason: "relevant" }),
    ]);
    const native = await runEvalSuite({
      name: "messages",
      cases: [{ id: "case", input: "conversation" }],
      target: () => ({
        output: "Hello Ada",
        usage: Usage.empty(),
        messages: [Message.user("My name is Ada"), Message.assistant("Hello Ada")],
      }),
      metrics: [turnRelevancy({ model: messageModel, includeReason: false })],
    });
    expect(native.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "pass", score: 1 });
  });

  it("detects knowledge attrition across assistant turns", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({ facts: ["Name is Ada"] }),
      judgeResponse({ facts: ["City is London"] }),
      judgeResponse({ attrition: false, reason: "remembered name" }),
      judgeResponse({ attrition: true, reason: "asked for city again" }),
    ]);
    const result = await runEvalSuite({
      name: "retention",
      cases: [{ id: "case", input: "conversation" }],
      target: () => [
        { role: "user" as const, content: "My name is Ada" },
        { role: "assistant" as const, content: "Hello Ada" },
        { role: "user" as const, content: "I live in London" },
        { role: "assistant" as const, content: "Which city do you live in?" },
      ],
      metrics: [knowledgeRetention({ model, includeReason: false, threshold: 0.75 })],
    });

    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "fail", score: 0.5 });
  });

  it("enforces strict scoring and validates required references and G-Eval rubrics", async () => {
    const strictModel = new QueueJudgeModel([
      judgeResponse({ statements: ["Relevant", "Tangent"] }),
      judgeResponse({
        verdicts: [
          { verdict: "yes", reason: "relevant" },
          { verdict: "no", reason: "irrelevant" },
        ],
      }),
    ]);
    const strict = await runEvalSuite({
      name: "strict",
      cases: [{ id: "case", input: "Question" }],
      target: () => "Answer",
      metrics: [
        answerRelevancy({
          model: strictModel,
          strictMode: true,
          includeReason: false,
        }),
      ],
    });
    expect(strict.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "fail",
      score: 0,
      metadata: {
        evaluation: { scoreDirection: "higher_is_better", threshold: 1, strictMode: true },
      },
    });

    const missingContext = await runEvalSuite({
      name: "missing-context",
      cases: [{ id: "case", input: "Question" }],
      target: () => "Answer",
      metrics: [
        hallucination({ model: new QueueJudgeModel([]), includeReason: false }),
        faithfulness({ model: new QueueJudgeModel([]), includeReason: false }),
      ],
    });
    expect(missingContext.invalid).toBe(2);

    expect(() =>
      gEval({
        name: "overlap",
        model: new QueueJudgeModel([]),
        evaluationParams: ["actualOutput"],
        evaluationSteps: ["Score the answer"],
        rubric: [
          { scoreRange: [0, 5], expectedOutcome: "weak" },
          { scoreRange: [5, 10], expectedOutcome: "strong" },
        ],
      }),
    ).toThrow("must not overlap");
  });
});

function judgeResponse(data: unknown): CompletionResponse {
  return {
    choice: [AssistantContent.toolCall("call", "submit", data as never)],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rawResponse: {},
  };
}
