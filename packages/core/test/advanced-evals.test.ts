import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  abstention,
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

type JudgeRoute = {
  matches: string;
  response: CompletionResponse;
};

class RoutedJudgeModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "routed-judge";
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
  maxActiveRequests = 0;
  private activeRequests = 0;
  private readonly routes: JudgeRoute[];

  constructor(
    routes: JudgeRoute[],
    private readonly delayMs = 0,
  ) {
    this.routes = [...routes];
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const requestText = JSON.stringify(request);
    const routeIndex = this.routes.findIndex((route) => requestText.includes(route.matches));
    if (routeIndex < 0) throw new Error(`No judge response matched request: ${requestText}`);
    const [route] = this.routes.splice(routeIndex, 1);
    if (route === undefined) throw new Error("Matched judge route was unavailable");

    this.activeRequests += 1;
    this.maxActiveRequests = Math.max(this.maxActiveRequests, this.activeRequests);
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      return route.response;
    } finally {
      this.activeRequests -= 1;
    }
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

    expect(result.metrics.passed).toBe(1);
    expect(result.metrics.failed).toBe(2);
    expect(result.metrics.invalid).toBe(0);
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
    const routes = (): JudgeRoute[] => [
      {
        matches: "truths from the supplied source material",
        response: judgeResponse({ facts: ["Refunds last 30 days"] }),
      },
      {
        matches: "factual claim made by the answer",
        response: judgeResponse({ facts: ["Refunds last 30 days", "Receipts are optional"] }),
      },
      {
        matches: "whether each answer claim is supported",
        response: judgeResponse({
          verdicts: [
            { verdict: "yes", reason: "supported" },
            { verdict: "idk", reason: "not stated" },
          ],
        }),
      },
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
      metrics: [faithfulness({ model: new RoutedJudgeModel(routes()), includeReason: false })],
    });
    const strict = await runEvalSuite({
      ...base,
      metrics: [
        faithfulness({
          model: new RoutedJudgeModel(routes()),
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
    const model = new RoutedJudgeModel([
      {
        matches: "truths from the supplied source material",
        response: judgeResponse({ facts: ["A", "B"] }),
      },
      {
        matches: "factual claim made by the summary",
        response: judgeResponse({ facts: ["A", "Invented"] }),
      },
      { matches: "Source", response: judgeResponse({ answers: ["yes", "yes"] }) },
      { matches: "Summary", response: judgeResponse({ answers: ["yes", "no"] }) },
      {
        matches: "whether each summary claim is supported",
        response: judgeResponse({
          verdicts: [
            { verdict: "yes", reason: "supported" },
            { verdict: "no", reason: "invented" },
          ],
        }),
      },
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

  it("bounds concurrent conversational judge requests", async () => {
    const retentionModel = new RoutedJudgeModel(
      [
        { matches: "My name is Ada", response: judgeResponse({ facts: ["Name is Ada"] }) },
        { matches: "I live in London", response: judgeResponse({ facts: ["City is London"] }) },
        { matches: "I use Pro", response: judgeResponse({ facts: ["Plan is Pro"] }) },
        {
          matches: "Hello Ada",
          response: judgeResponse({ attrition: false, reason: "remembered name" }),
        },
        {
          matches: "London noted",
          response: judgeResponse({ attrition: false, reason: "remembered city" }),
        },
        {
          matches: "Pro plan confirmed",
          response: judgeResponse({ attrition: false, reason: "remembered plan" }),
        },
      ],
      5,
    );
    const result = await runEvalSuite({
      name: "bounded-retention",
      cases: [{ id: "case", input: "conversation" }],
      target: () => [
        { role: "user" as const, content: "My name is Ada" },
        { role: "assistant" as const, content: "Hello Ada" },
        { role: "user" as const, content: "I live in London" },
        { role: "assistant" as const, content: "London noted" },
        { role: "user" as const, content: "I use Pro" },
        { role: "assistant" as const, content: "Pro plan confirmed" },
      ],
      metrics: [
        knowledgeRetention({ model: retentionModel, concurrency: 2, includeReason: false }),
      ],
    });

    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({ outcome: "pass", score: 1 });
    expect(retentionModel.maxActiveRequests).toBe(2);

    const relevancyModel = new RoutedJudgeModel(
      [
        {
          matches: "Hello Ada",
          response: judgeResponse({ verdict: "yes", reason: "relevant" }),
        },
        {
          matches: "London noted",
          response: judgeResponse({ verdict: "yes", reason: "relevant" }),
        },
        {
          matches: "Pro plan confirmed",
          response: judgeResponse({ verdict: "yes", reason: "relevant" }),
        },
      ],
      5,
    );
    const relevancy = await runEvalSuite({
      name: "bounded-relevancy",
      cases: [{ id: "case", input: "conversation" }],
      target: () => [
        { role: "user" as const, content: "My name is Ada" },
        { role: "assistant" as const, content: "Hello Ada" },
        { role: "user" as const, content: "I live in London" },
        { role: "assistant" as const, content: "London noted" },
        { role: "user" as const, content: "I use Pro" },
        { role: "assistant" as const, content: "Pro plan confirmed" },
      ],
      metrics: [turnRelevancy({ model: relevancyModel, concurrency: 2, includeReason: false })],
    });

    expect(relevancy.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "pass",
      score: 1,
    });
    expect(relevancyModel.maxActiveRequests).toBe(2);
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
    expect(missingContext.metrics.invalid).toBe(2);
    expect(missingContext.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "invalid",
      reason: expect.stringContaining("context must be a non-empty array of strings"),
    });
    expect(missingContext.results[0]?.metrics[1]?.outcome).toMatchObject({
      outcome: "invalid",
      reason: expect.stringContaining("retrievalContext must be a non-empty array of strings"),
    });

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

  it("classifies the four abstention outcomes and aggregates judge usage", async () => {
    const model = new QueueJudgeModel([
      judgeResponse({ behavior: "abstention", grounded: false, reason: "No policy exists." }),
      judgeResponse({
        behavior: "abstention",
        grounded: false,
        reason: "The answer was available.",
      }),
      judgeResponse({
        behavior: "confident_answer",
        grounded: false,
        reason: "Unsupported claim.",
      }),
      judgeResponse({ behavior: "confident_answer", grounded: true, reason: "Supported claim." }),
    ]);
    const result = await runEvalSuite({
      name: "abstention",
      cases: [
        { id: "correct-abstention", input: "unknown" },
        { id: "unnecessary-abstention", input: "known", retrievalContext: ["Known fact"] },
        { id: "unsupported", input: "known", retrievalContext: ["Known fact"] },
        { id: "grounded", input: "known", retrievalContext: ["Known fact"] },
      ],
      target: (input) => input,
      metrics: [
        abstention({
          model,
          shouldAbstain: ({ case: testCase }) => testCase.id === "correct-abstention",
        }),
      ],
    });

    expect(result.results.map((caseResult) => caseResult.metrics[0]?.outcome)).toEqual([
      expect.objectContaining({ outcome: "pass", score: "correct_abstention" }),
      expect.objectContaining({ outcome: "fail", score: "unnecessary_abstention" }),
      expect.objectContaining({ outcome: "fail", score: "unsupported_confident_answer" }),
      expect.objectContaining({ outcome: "pass", score: "correct_grounded_answer" }),
    ]);
    expect(result.usage.evaluation.totalTokens).toBe(8);
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
