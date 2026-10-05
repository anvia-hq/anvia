import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  abstention,
  answerRelevancy,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type EmbeddingModel,
  type EvalMetricArgs,
  faithfulness,
  gEval,
  hallucination,
  jsonCorrectness,
  knowledgeRetention,
  llmJudge,
  llmScore,
  type ModelCallOptions,
  promptAlignment,
  runEvalSuite,
  semanticSimilarity,
  summarization,
  turnRelevancy,
  Usage,
} from "./helpers/imports";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

function metricArgs(signal: AbortSignal, id = "case"): EvalMetricArgs<string, string> {
  return { suiteName: "cancellation", case: { id, input: "Question" }, output: "Answer", signal };
}

function judgeResponse(data: unknown): CompletionResponse {
  return {
    choice: [{ type: "tool-call", toolCallId: "call", toolName: "submit", input: data as never }],
    usage: { ...Usage.empty(), inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    rawResponse: {},
  };
}

class JudgeModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "cancellation-judge";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly calls: Array<{ request: CompletionRequest; signal: AbortSignal | undefined }> = [];

  constructor(
    private readonly respond: (
      request: CompletionRequest,
      signal: AbortSignal | undefined,
      index: number,
    ) => Promise<CompletionResponse>,
  ) {}

  completion(request: CompletionRequest, options?: ModelCallOptions) {
    this.calls.push({ request, signal: options?.abortSignal });
    return this.respond(request, options?.abortSignal, this.calls.length - 1);
  }
}

function trackListeners(signal: AbortSignal) {
  const listeners = new Set<Parameters<AbortSignal["addEventListener"]>[1]>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort" && listener !== null) listeners.add(listener);
    add(type, listener, options);
  });
  vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort" && listener !== null) listeners.delete(listener);
    remove(type, listener, options);
  });
  return () => listeners.size;
}

const turns = [
  { role: "user" as const, content: "My name is Ada" },
  { role: "assistant" as const, content: "Hello Ada" },
  { role: "user" as const, content: "What is my name?" },
  { role: "assistant" as const, content: "Ada" },
  { role: "user" as const, content: "Remember it" },
  { role: "assistant" as const, content: "Ada" },
];

function gMetric(model: CompletionModel) {
  return gEval({
    name: "quality",
    model,
    criteria: "Compare the answer",
    evaluationParams: ["actualOutput"],
  });
}

function preparationModel() {
  const preparations: Array<{
    signal: AbortSignal | undefined;
    result: ReturnType<typeof deferred<CompletionResponse>>;
  }> = [];
  const setupStarted = deferred<void>();
  let scores = 0;
  const model = new JudgeModel(async (request, signal) => {
    if (JSON.stringify(request).includes("Generate three or four")) {
      const result = deferred<CompletionResponse>();
      preparations.push({ signal, result });
      setupStarted.resolve();
      return result.promise;
    }
    scores += 1;
    return judgeResponse({ score: 10, reason: "Correct" });
  });
  return { model, preparations, setupStarted, scores: () => scores };
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("evaluation metric cancellation", () => {
  it("stops both semantic embeddings on case timeout and retains the successful score", async () => {
    let active = 0;
    let stopped = 0;
    const model: EmbeddingModel = {
      provider: "test",
      modelId: "embedding",
      embedTexts(texts, options) {
        active += 1;
        return new Promise((resolve, reject) => {
          const signal = options?.abortSignal;
          const onAbort = () => {
            signal?.removeEventListener("abort", onAbort);
            active -= 1;
            stopped += 1;
            reject(signal?.reason);
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort);
          if (signal === undefined) {
            active -= 1;
            resolve(texts.map((document) => ({ document, vector: [1, 0] })));
          }
        });
      },
    };
    const result = await runEvalSuite({
      name: "semantic-timeout",
      cases: [{ id: "case", input: "question", expected: "Answer" }],
      target: () => "Answer",
      metrics: [semanticSimilarity({ model, threshold: 0.5 })],
      caseTimeoutMs: 20,
    });
    await flush();
    expect(result.results[0]?.metrics[0]?.outcome).toMatchObject({
      outcome: "invalid",
      kind: "timeout",
    });
    expect({ active, stopped }).toEqual({ active: 0, stopped: 2 });
    const control: EmbeddingModel = {
      provider: "test",
      modelId: "control",
      async embedTexts(texts) {
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    expect(
      await semanticSimilarity({ model: control, threshold: 0.5, expected: "Answer" }).evaluate(
        metricArgs(new AbortController().signal),
      ),
    ).toMatchObject({ outcome: "pass", score: 1 });
  });

  it.each(["judge", "score"] as const)(
    "cancels %s during retry delay without a second attempt or timer",
    async (kind) => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      try {
        const controller = new AbortController();
        const model = new JudgeModel(async () => judgeResponse({ malformed: true }));
        const metric =
          kind === "judge"
            ? llmJudge({
                model,
                schema: z.object({ ok: z.boolean() }),
                passes: (data) => data.ok,
                retries: 2,
              })
            : llmScore({ model, criteria: "Correct", threshold: 0.5, retries: 2 });
        const pending = metric.evaluate(metricArgs(controller.signal));
        await vi.advanceTimersByTimeAsync(0);
        expect(model.calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);
        controller.abort(new Error("stop retry"));
        expect(await pending).toMatchObject({ outcome: "invalid" });
        expect(model.calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
        const control = new JudgeModel(async () =>
          judgeResponse(kind === "judge" ? { ok: true } : { score: 1, feedback: "Correct" }),
        );
        const controlMetric =
          kind === "judge"
            ? llmJudge({
                model: control,
                schema: z.object({ ok: z.boolean() }),
                passes: (data) => data.ok,
              })
            : llmScore({ model: control, criteria: "Correct", threshold: 0.5 });
        expect(
          await controlMetric.evaluate(metricArgs(new AbortController().signal)),
        ).toMatchObject({
          outcome: "pass",
          score: kind === "judge" ? { ok: true } : { score: 1, feedback: "Correct" },
        });
      } finally {
        random.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  const lanes = [
    {
      name: "answer verdict",
      make: (model: CompletionModel) => answerRelevancy({ model, includeReason: false }),
      ready: [{ statements: ["Fact"] }],
      blocked: 1,
      output: "Answer",
      score: 1,
      rest: [{ verdicts: [{ verdict: "yes", reason: "Correct" }] }],
    },
    {
      name: "answer reason",
      make: (model: CompletionModel) => answerRelevancy({ model }),
      ready: [{ statements: [] }],
      blocked: 1,
      output: "Answer",
      score: 1,
      rest: [{ reason: "Correct" }],
    },
    {
      name: "prompt alignment",
      make: (model: CompletionModel) =>
        promptAlignment({ model, promptInstructions: ["Be correct"], includeReason: false }),
      ready: [],
      blocked: 0,
      output: "Answer",
      score: 1,
      rest: [{ verdicts: [{ verdict: "yes", reason: "Correct" }] }],
    },
    {
      name: "hallucination",
      make: (model: CompletionModel) =>
        hallucination({ model, context: ["Fact"], includeReason: false }),
      ready: [],
      blocked: 0,
      output: "Answer",
      score: 0,
      rest: [{ verdicts: [{ verdict: "yes", reason: "Correct" }] }],
    },
    {
      name: "faithfulness fan-out",
      make: (model: CompletionModel) =>
        faithfulness({ model, retrievalContext: ["Fact"], includeReason: false }),
      ready: [],
      blocked: 0,
      output: "Answer",
      score: 1,
      rest: [{ facts: ["Fact"] }, { facts: [] }],
    },
    {
      name: "summarization fan-out",
      make: (model: CompletionModel) =>
        summarization({ model, includeReason: false, assessmentQuestions: ["Fact?"] }),
      ready: [],
      blocked: 0,
      output: "Answer",
      score: 1,
      rest: [
        { facts: ["Fact"] },
        { facts: ["Fact"] },
        { answers: ["yes"] },
        { answers: ["yes"] },
        { verdicts: [{ verdict: "yes", reason: "Correct" }] },
      ],
    },
    {
      name: "turn fan-out",
      make: (model: CompletionModel) =>
        turnRelevancy({ model, concurrency: 2, includeReason: false }),
      ready: [],
      blocked: 0,
      output: turns,
      score: 1,
      rest: Array.from({ length: 3 }, () => ({ verdict: "yes", reason: "Correct" })),
    },
    {
      name: "knowledge fan-out",
      make: (model: CompletionModel) =>
        knowledgeRetention({ model, concurrency: 2, includeReason: false }),
      ready: [],
      blocked: 0,
      output: turns,
      score: 1,
      rest: [
        ...Array.from({ length: 3 }, () => ({ facts: ["Ada"] })),
        ...Array.from({ length: 3 }, () => ({ attrition: false, reason: "Correct" })),
      ],
    },
    {
      name: "JSON reason",
      make: (model: CompletionModel) =>
        jsonCorrectness({ model, schema: z.object({ ok: z.boolean() }) }),
      ready: [],
      blocked: 0,
      output: "bad json",
      score: 0,
      rest: [{ reason: "Invalid JSON" }],
    },
    {
      name: "abstention",
      make: (model: CompletionModel) => abstention({ model, shouldAbstain: true }),
      ready: [],
      blocked: 0,
      output: "Answer",
      score: "correct_abstention",
      rest: [{ behavior: "abstention", grounded: false, reason: "Unknown" }],
    },
  ];

  it.each(lanes)("stops $name and keeps its literal successful score", async (lane) => {
    const controller = new AbortController();
    const started = deferred<void>();
    let active = 0;
    let stopped = 0;
    const model = new JudgeModel(async (_request, signal, index) => {
      if (index < lane.blocked) return judgeResponse(lane.ready[index]);
      active += 1;
      started.resolve();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          active -= 1;
          stopped += 1;
          reject(signal?.reason);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort);
      });
    });
    const pending = lane
      .make(model)
      .evaluate({ ...metricArgs(controller.signal), output: lane.output });
    await started.promise;
    await flush();
    const attempts = model.calls.length;
    controller.abort(new Error("stop advanced metric"));
    expect(await pending).toMatchObject({ outcome: "invalid" });
    await flush();
    expect(active).toBe(0);
    expect(stopped).toBe(attempts - lane.blocked);
    expect(model.calls).toHaveLength(attempts);
    expect(model.calls.every((call) => call.signal === controller.signal)).toBe(true);
    const queue = [...lane.ready, ...lane.rest];
    const control = new JudgeModel(async (_request, _signal, index) => judgeResponse(queue[index]));
    const outcome = await lane
      .make(control)
      .evaluate({ ...metricArgs(new AbortController().signal), output: lane.output });
    expect(outcome).toMatchObject({
      outcome: lane.score === 0 ? (lane.name === "hallucination" ? "pass" : "fail") : "pass",
      score: lane.score,
    });
  });

  it("guards local no-reason success after a selector aborts", async () => {
    const controller = new AbortController();
    const metric = jsonCorrectness({
      schema: z.object({ ok: z.boolean() }),
      includeReason: false,
      actual: () => {
        controller.abort("stop local");
        return '{"ok":true}';
      },
    });
    expect(await metric.evaluate(metricArgs(controller.signal))).toMatchObject({
      outcome: "invalid",
    });
    expect(
      await jsonCorrectness({
        schema: z.object({ ok: z.boolean() }),
        includeReason: false,
      }).evaluate({ ...metricArgs(new AbortController().signal), output: '{"ok":true}' }),
    ).toMatchObject({ outcome: "pass", score: 1 });
  });

  it("lets one shared waiter cancel while the survivor claims setup usage once", async () => {
    const fixture = preparationModel();
    const metric = gMetric(fixture.model);
    const a = new AbortController();
    const b = new AbortController();
    const balanceA = trackListeners(a.signal);
    const balanceB = trackListeners(b.signal);
    const cancelled = metric.evaluate(metricArgs(a.signal, "a"));
    const survivor = metric.evaluate(metricArgs(b.signal, "b"));
    await fixture.setupStarted.promise;
    a.abort(new Error("cancel-a"));
    expect(await cancelled).toMatchObject({ outcome: "invalid" });
    expect(balanceA()).toBe(0);
    expect(fixture.preparations[0]?.signal?.aborted).toBe(false);
    fixture.preparations[0]?.result.resolve(judgeResponse({ steps: ["Compare"] }));
    expect(await survivor).toMatchObject({ outcome: "pass", score: 1, usage: { totalTokens: 4 } });
    expect(await metric.evaluate(metricArgs(new AbortController().signal))).toMatchObject({
      outcome: "pass",
      score: 1,
      usage: { totalTokens: 2 },
    });
    expect(fixture.preparations).toHaveLength(1);
    expect(fixture.scores()).toBe(2);
    expect(balanceB()).toBe(0);
  });

  it("deduplicates two live cases and leaves one setup usage charge", async () => {
    const fixture = preparationModel();
    const metric = gMetric(fixture.model);
    const p = metric.evaluate(metricArgs(new AbortController().signal, "a"));
    const q = metric.evaluate(metricArgs(new AbortController().signal, "b"));
    await fixture.setupStarted.promise;
    fixture.preparations[0]?.result.resolve(judgeResponse({ steps: ["Compare"] }));
    const outcomes = await Promise.all([p, q]);
    expect(outcomes.map((outcome) => outcome.score)).toEqual([1, 1]);
    expect(outcomes.map((outcome) => outcome.usage?.totalTokens)).toEqual([4, 2]);
    expect(fixture.model.calls).toHaveLength(3);
  });

  it.each(["resolve", "reject"] as const)(
    "detaches the last waiter and ignores stale setup %s",
    async (settlement) => {
      const fixture = preparationModel();
      const metric = gMetric(fixture.model);
      const a = new AbortController();
      const b = new AbortController();
      const balanceA = trackListeners(a.signal);
      const balanceB = trackListeners(b.signal);
      const p = metric.evaluate(metricArgs(a.signal, "a"));
      const q = metric.evaluate(metricArgs(b.signal, "b"));
      await fixture.setupStarted.promise;
      a.abort("cancel-a");
      expect(fixture.preparations[0]?.signal?.aborted).toBe(false);
      b.abort("cancel-b");
      expect(fixture.preparations[0]?.signal?.aborted).toBe(true);
      expect((await Promise.all([p, q])).map((outcome) => outcome.outcome)).toEqual([
        "invalid",
        "invalid",
      ]);
      expect([balanceA(), balanceB()]).toEqual([0, 0]);
      const replacement = metric.evaluate(metricArgs(new AbortController().signal));
      await flush();
      expect(fixture.preparations).toHaveLength(2);
      if (settlement === "resolve")
        fixture.preparations[0]?.result.resolve(judgeResponse({ steps: ["Stale"] }));
      else fixture.preparations[0]?.result.reject(new Error("stale failure"));
      await flush();
      const additional = metric.evaluate(metricArgs(new AbortController().signal));
      await flush();
      expect(fixture.preparations).toHaveLength(2);
      fixture.preparations[1]?.result.resolve(judgeResponse({ steps: ["Replacement"] }));
      expect(await replacement).toMatchObject({
        outcome: "pass",
        score: 1,
        usage: { totalTokens: 4 },
        metadata: { evaluation: { evaluationSteps: ["Replacement"] } },
      });
      expect(await additional).toMatchObject({
        outcome: "pass",
        score: 1,
        usage: { totalTokens: 2 },
      });
    },
  );

  it.each(["reject", "empty"] as const)(
    "resets setup after %s without losing the new usage charge",
    async (failure) => {
      const fixture = preparationModel();
      const metric = gMetric(fixture.model);
      const first = metric.evaluate(metricArgs(new AbortController().signal));
      await fixture.setupStarted.promise;
      if (failure === "reject") fixture.preparations[0]?.result.reject(new Error("setup failed"));
      else fixture.preparations[0]?.result.resolve(judgeResponse({ steps: [] }));
      expect(await first).toMatchObject({ outcome: "invalid" });
      const second = metric.evaluate(metricArgs(new AbortController().signal));
      await flush();
      fixture.preparations[1]?.result.resolve(judgeResponse({ steps: ["Compare"] }));
      expect(await second).toMatchObject({ outcome: "pass", score: 1, usage: { totalTokens: 4 } });
      expect(fixture.preparations).toHaveLength(2);
    },
  );

  it("owns cached steps and gives each outcome a detached array", async () => {
    const fixture = preparationModel();
    const metric = gMetric(fixture.model);
    const first = metric.evaluate(metricArgs(new AbortController().signal));
    await fixture.setupStarted.promise;
    const source = ["Compare"];
    fixture.preparations[0]?.result.resolve(judgeResponse({ steps: source }));
    const outcome = await first;
    source[0] = "Provider mutation";
    const evaluation = outcome.metadata?.evaluation as { evaluationSteps: string[] };
    const steps = evaluation.evaluationSteps;
    steps[0] = "Outcome mutation";
    expect(await metric.evaluate(metricArgs(new AbortController().signal))).toMatchObject({
      outcome: "pass",
      score: 1,
      metadata: { evaluation: { evaluationSteps: ["Compare"] } },
    });
    expect(fixture.preparations).toHaveLength(1);
  });

  it("stops cooperative preparation only after the last waiter leaves", async () => {
    let active = 0;
    let stopped = 0;
    const started = deferred<void>();
    const model = new JudgeModel(async (_request, signal) => {
      active += 1;
      started.resolve();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          active -= 1;
          stopped += 1;
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort);
      });
    });
    const metric = gMetric(model);
    const a = new AbortController();
    const b = new AbortController();
    const first = metric.evaluate(metricArgs(a.signal));
    const second = metric.evaluate(metricArgs(b.signal));
    await started.promise;
    a.abort("cancel-a");
    expect(active).toBe(1);
    b.abort("cancel-b");
    expect((await Promise.all([first, second])).map((outcome) => outcome.outcome)).toEqual([
      "invalid",
      "invalid",
    ]);
    expect({ active, stopped }).toEqual({ active: 0, stopped: 1 });
    const control = new JudgeModel(async () => judgeResponse({ score: 10, reason: "Correct" }));
    expect(
      await gEval({
        name: "control",
        model: control,
        evaluationSteps: ["Compare"],
        evaluationParams: ["actualOutput"],
      }).evaluate(metricArgs(new AbortController().signal)),
    ).toMatchObject({ outcome: "pass", score: 1 });
  });

  it("starts no reason or verdict after a cancellation-ignoring judge returns", async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const held = deferred<CompletionResponse>();
    const model = new JudgeModel(async () => {
      started.resolve();
      return held.promise;
    });
    const pending = answerRelevancy({ model }).evaluate(metricArgs(controller.signal));
    await started.promise;
    controller.abort("stop phases");
    held.resolve(judgeResponse({ statements: ["Fact"] }));
    expect(await pending).toMatchObject({ outcome: "invalid" });
    expect(model.calls).toHaveLength(1);
    const responses = [
      { statements: ["Fact"] },
      { verdicts: [{ verdict: "yes", reason: "Correct" }] },
      { reason: "Correct" },
    ];
    const control = new JudgeModel(async (_request, _signal, index) =>
      judgeResponse(responses[index]),
    );
    expect(
      await answerRelevancy({ model: control }).evaluate(metricArgs(new AbortController().signal)),
    ).toMatchObject({ outcome: "pass", score: 1, comment: "Correct" });
    expect(control.calls).toHaveLength(3);
  });

  it("starts no provider work for pre-aborted cases and supplied steps skip setup", async () => {
    const fixture = preparationModel();
    const controller = new AbortController();
    controller.abort("pre-aborted");
    expect(await gMetric(fixture.model).evaluate(metricArgs(controller.signal))).toMatchObject({
      outcome: "invalid",
    });
    expect(fixture.model.calls).toHaveLength(0);
    const supplied = gEval({
      name: "quality",
      model: fixture.model,
      evaluationSteps: ["Compare"],
      evaluationParams: ["actualOutput"],
    });
    expect(await supplied.evaluate(metricArgs(new AbortController().signal))).toMatchObject({
      outcome: "pass",
      score: 1,
      usage: { totalTokens: 2 },
    });
    expect(fixture.preparations).toHaveLength(0);
    expect(fixture.scores()).toBe(1);
  });
});
