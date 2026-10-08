import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  check,
  choice,
  decide,
  decideBatch,
  DecisionCapabilityError,
  DecisionProviderOutputError,
  DecisionRefusalError,
  multiLabel,
  score,
  type DecisionAnswers,
  type DecisionCapabilities,
  type DecisionModel,
  type DecisionQuestions,
} from "../src/decision";
import * as root from "../src/index";

const capabilities: DecisionCapabilities = {
  questionSupport: { choice: "native", "multi-label": "native", score: "native", check: "native" },
  mixedQuestions: true,
};

function fakeModel(answers: unknown, overrides: Partial<DecisionModel> = {}): DecisionModel {
  return {
    provider: "test",
    modelId: "decision-test",
    capabilities,
    decision: vi.fn(async <Q extends DecisionQuestions>() => ({
      answers: answers as DecisionAnswers<Q>,
      rawResponse: { requestId: "test" },
    })) as DecisionModel["decision"],
    ...overrides,
  };
}

const category = choice({
  instructions: "Which category?",
  options: { billing: null, other: null },
});

describe("decision operations", () => {
  it("infers answer keys, labels, and rubric types and exports operations from core", async () => {
    const rubric = ["Low", "High"] as const;
    const result = await decide({
      model: fakeModel({
        category: {
          type: "choice",
          choice: "billing",
          confidence: 0.4,
          probabilities: { billing: 0.8, other: 0.2 },
        },
        topics: {
          type: "multi-label",
          labels: ["refund"],
          probabilities: { refund: 0.8, cancellation: 0.1 },
        },
        severity: { type: "score", score: 0.8, rubric, probabilities: [0.2, 0.8] },
        urgent: { type: "check", probability: 0.9 },
      }),
      state: { ticket: "Please refund my payment." },
      questions: {
        category,
        topics: multiLabel({
          instructions: "Which topics apply?",
          options: { refund: null, cancellation: null },
        }),
        severity: score({ instructions: "How severe?", rubric }),
        urgent: check({ instructions: "Is it urgent?" }),
      },
    });
    expectTypeOf(result.answers.category.choice).toEqualTypeOf<"billing" | "other">();
    expectTypeOf(result.answers.topics.labels).toEqualTypeOf<
      readonly ("refund" | "cancellation")[]
    >();
    expectTypeOf(result.answers.severity.rubric).toEqualTypeOf<typeof rubric>();
    expectTypeOf(result.answers.urgent.probability).toEqualTypeOf<number>();
    expect(result.answers.category.confidence).toBe(0.4);
    expect(result.rawResponse).toEqual({ requestId: "test" });
    expect(result.usage).toBeUndefined();
    expect(root.decide).toBe(decide);
    expect(root.multiLabel).toBe(multiLabel);
    expect(root.DecisionRefusalError).toBe(DecisionRefusalError);
  });

  it("preserves a concrete model's raw response type", async () => {
    const model: DecisionModel<{ id: string }> = {
      provider: "test",
      modelId: "typed",
      capabilities,
      async decision<Q extends DecisionQuestions>() {
        return {
          answers: { urgent: { type: "check", probability: 0.2 } } as DecisionAnswers<Q>,
          rawResponse: { id: "raw" },
        };
      },
    };
    const result = await decide({
      model,
      state: null,
      questions: { urgent: check({ instructions: "Urgent?" }) },
    });
    expectTypeOf(result.rawResponse).toEqualTypeOf<{ id: string }>();
  });

  it.each([
    () => choice({ instructions: " ", options: { a: null } }),
    () => choice({ instructions: "Choose", options: {} }),
    () => choice({ instructions: "Choose", options: { " ": null } }),
    () => score({ instructions: "Score", rubric: ["One"] as never }),
    () => multiLabel({ instructions: "Select", options: { a: null }, threshold: NaN }),
    () => multiLabel({ instructions: "Select", options: { a: null }, threshold: 1.1 }),
  ])("rejects invalid question definitions", (create) => {
    expect(create).toThrow();
  });

  it("rejects invalid external state and questions before calling the model", async () => {
    const model = fakeModel({});
    for (const state of [NaN, new Date(), { value: undefined }]) {
      await expect(
        decide({ model, state: state as never, questions: { category } }),
      ).rejects.toThrow(TypeError);
    }
    await expect(decide({ model, state: "ticket", questions: {} })).rejects.toThrow(TypeError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      decide({ model, state: cyclic as never, questions: { category } }),
    ).rejects.toThrow(TypeError);
    const getter = vi.fn(() => "ticket");
    await expect(
      decide({
        model,
        state: {
          get ticket() {
            return getter();
          },
        },
        questions: { category },
      }),
    ).rejects.toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(model.decision).not.toHaveBeenCalled();
  });

  it("rejects unsupported shapes, mixed requests, and limits before provider work", async () => {
    const model = fakeModel(
      {},
      {
        capabilities: {
          ...capabilities,
          questionSupport: { ...capabilities.questionSupport, score: "unsupported" },
          limits: { maxChoiceOptions: 1 },
        },
      },
    );
    await expect(
      decide({
        model,
        state: null,
        questions: { severity: score({ instructions: "Score", rubric: ["Low", "High"] }) },
      }),
    ).rejects.toBeInstanceOf(DecisionCapabilityError);
    await expect(decide({ model, state: null, questions: { category } })).rejects.toThrow(
      RangeError,
    );
    const mixed = fakeModel({}, { capabilities: { ...capabilities, mixedQuestions: false } });
    await expect(
      decide({
        model: mixed,
        state: null,
        questions: { category, urgent: check({ instructions: "Urgent?" }) },
      }),
    ).rejects.toThrow("mixed questions");
    expect(model.decision).not.toHaveBeenCalled();
    expect(mixed.decision).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { category: { type: "check", probability: 0.5 } },
    { category: { type: "choice", choice: "unknown" } },
    { category: { type: "choice", choice: "billing", confidence: NaN } },
    {
      category: { type: "choice", choice: "billing", probabilities: { billing: 0.6, other: 0.6 } },
    },
    { category: { type: "choice", choice: "billing", probabilities: { billing: 1 } } },
    { category: { type: "choice", choice: "billing" }, extra: { type: "check", probability: 0.5 } },
  ])("rejects malformed or mismatched provider answers", async (answers) => {
    await expect(
      decide({ model: fakeModel(answers), state: null, questions: { category } }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it("allows omitted provider metadata and explicit undefined optional fields", async () => {
    const result = await decide({
      model: fakeModel({ category: { type: "choice", choice: "billing", confidence: undefined } }),
      state: null,
      questions: { category },
    });
    expect(result.answers.category.choice).toBe("billing");
  });

  it("enforces independent multi-label thresholds without normalizing probabilities", async () => {
    const questions = {
      tags: multiLabel({ instructions: "Topics?", options: { a: null, b: null }, threshold: 0.8 }),
    };
    const result = await decide({
      model: fakeModel({
        tags: { type: "multi-label", labels: ["a"], probabilities: { a: 0.8, b: 0.7 } },
      }),
      state: null,
      questions,
    });
    expect(result.answers.tags.labels).toEqual(["a"]);
    await expect(
      decide({
        model: fakeModel({
          tags: { type: "multi-label", labels: ["a", "b"], probabilities: { a: 0.8, b: 0.7 } },
        }),
        state: null,
        questions,
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it("rejects invalid boolean probabilities, score levels, and usage", async () => {
    for (const probability of [NaN, -0.1, 1.1]) {
      await expect(
        decide({
          model: fakeModel({ urgent: { type: "check", probability } }),
          state: null,
          questions: { urgent: check({ instructions: "Urgent?" }) },
        }),
      ).rejects.toBeInstanceOf(DecisionProviderOutputError);
    }
    await expect(
      decide({
        model: fakeModel({ severity: { type: "score", score: 2, rubric: ["Low", "High"] } }),
        state: null,
        questions: { severity: score({ instructions: "Score", rubric: ["Low", "High"] }) },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
    const model = fakeModel({ category: { type: "choice", choice: "billing" } });
    vi.mocked(model.decision).mockResolvedValueOnce({
      answers: { category: { type: "choice", choice: "billing" } } as never,
      rawResponse: null,
      usage: { inputTokens: -1 } as never,
    });
    await expect(decide({ model, state: null, questions: { category } })).rejects.toBeInstanceOf(
      DecisionProviderOutputError,
    );
  });

  it("compares structured rubrics by JSON content while preserving level and array order", async () => {
    const questions = {
      rating: score({
        instructions: "Rate quality",
        rubric: [
          { label: "Low", details: { examples: ["bad", "poor"] } },
          { label: "High", details: { examples: ["good", "great"] } },
        ],
      }),
    };
    const rubric = [
      { details: { examples: ["bad", "poor"] }, label: "Low" },
      { details: { examples: ["good", "great"] }, label: "High" },
    ];
    const model = (levels: unknown) =>
      fakeModel({ rating: { type: "score", score: 0.5, rubric: levels } });
    await expect(decide({ model: model(rubric), state: null, questions })).resolves.toMatchObject({
      answers: { rating: { score: 0.5 } },
    });
    for (const changed of [
      [...rubric].reverse(),
      [rubric[0], { label: "High", details: { examples: ["great", "good"] } }],
      [rubric[0], { label: "High", details: { examples: ["good", "different"] } }],
    ]) {
      await expect(
        decide({ model: model(changed), state: null, questions }),
      ).rejects.toBeInstanceOf(DecisionProviderOutputError);
    }
  });

  it("retries transient failures only when requested and passes cancellation options", async () => {
    const model = fakeModel({ category: { type: "choice", choice: "billing" } });
    const failure = Object.assign(new Error("Unavailable"), { status: 503 });
    vi.mocked(model.decision).mockRejectedValueOnce(failure);
    await expect(decide({ model, state: "ticket", questions: { category } })).rejects.toBe(failure);
    expect(model.decision).toHaveBeenCalledTimes(1);
    vi.mocked(model.decision).mockRejectedValueOnce(failure);
    const controller = new AbortController();
    await decide({
      model,
      state: "ticket",
      questions: { category },
      providerOptions: { mode: "fast" },
      abortSignal: controller.signal,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    expect(model.decision).toHaveBeenCalledTimes(3);
    expect(model.decision).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerOptions: { mode: "fast" } }),
      { abortSignal: controller.signal },
    );
  });

  it("rejects pre-aborted and late-aborted calls even if the provider ignores cancellation", async () => {
    const controller = new AbortController();
    const model = fakeModel({ category: { type: "choice", choice: "billing" } });
    controller.abort();
    await expect(
      decide({ model, state: null, questions: { category }, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(model.decision).not.toHaveBeenCalled();
    const late = new AbortController();
    vi.mocked(model.decision).mockImplementationOnce(async () => {
      late.abort("cancel");
      return {
        answers: { category: { type: "choice", choice: "billing" } } as never,
        rawResponse: null,
      };
    });
    await expect(
      decide({ model, state: null, questions: { category }, abortSignal: late.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("decision batches", () => {
  it("bounds concurrency, preserves order, and captures individual failures", async () => {
    const pending = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;
    const model: DecisionModel = {
      provider: "test",
      modelId: "batch",
      capabilities,
      async decision<Q extends DecisionQuestions>(request: { state: unknown; questions: Q }) {
        const state = String(request.state);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => pending.set(state, resolve));
        active--;
        if (state === "bad") throw new Error("failed item");
        return {
          answers: { urgent: { type: "check", probability: 0.8 } } as DecisionAnswers<Q>,
          rawResponse: state,
        };
      },
    };
    const inputs = ["first", "bad", "last"].map((state) => ({
      state,
      questions: { urgent: check({ instructions: "Urgent?" }) },
    }));
    const running = decideBatch({ model, inputs, concurrency: 2 });
    await vi.waitFor(() => expect(pending.size).toBe(2));
    pending.get("bad")!();
    await vi.waitFor(() => expect(pending.has("last")).toBe(true));
    pending.get("last")!();
    pending.get("first")!();
    const result = await running;
    expect(maxActive).toBe(2);
    expect(result.items.map(({ index, status }) => ({ index, status }))).toEqual([
      { index: 0, status: "completed" },
      { index: 1, status: "failed" },
      { index: 2, status: "completed" },
    ]);
  });

  it("validates concurrency on empty inputs and stops scheduling after cancellation", async () => {
    const model = fakeModel({ urgent: { type: "check", probability: 0.8 } });
    await expect(decideBatch({ model, inputs: [], concurrency: 0 })).rejects.toThrow(RangeError);
    const controller = new AbortController();
    vi.mocked(model.decision).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("provider cancelled");
    });
    const inputs = [1, 2].map((state) => ({
      state,
      questions: { urgent: check({ instructions: "Urgent?" }) },
    }));
    await expect(
      decideBatch({ model, inputs, concurrency: 1, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(model.decision).toHaveBeenCalledTimes(1);
  });
});
