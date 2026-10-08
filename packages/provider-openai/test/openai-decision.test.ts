import OpenAI from "openai";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  check,
  choice,
  decide,
  decideBatch,
  multiLabel,
  score,
  DecisionProviderOutputError,
  DecisionRefusalError,
} from "@anvia/core/decision";
import { GPT_6_LUNA, OpenAIClient, openai, type OpenAIDecisionModelId } from "../src/index";

function fixture(answers: unknown) {
  return {
    model: GPT_6_LUNA,
    answers,
    usage: {
      input_tokens: 12,
      output_tokens: 3,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
  };
}
function clientWithResponse(raw: unknown) {
  const fetch = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(raw), {
        headers: { "Content-Type": "application/json", "x-request-id": "req-test" },
      }),
  );
  const sdk = new OpenAI({ apiKey: "test-key", fetch, maxRetries: 4 });
  return { client: new OpenAIClient({ client: sdk }), fetch };
}
afterEach(() => vi.unstubAllGlobals());

const rating = score({ instructions: "Score", rubric: ["Low", "High"] });
const pick = choice({ instructions: "Pick", options: { a: null, b: "B" } });
const choiceAnswer = {
  type: "choice",
  name: "q0",
  choice: "a",
  confidence: 0.4,
  probabilities: [
    { value: "a", probability: 0.8 },
    { value: "b", probability: 0.2 },
  ],
};
const scoreAnswer = {
  type: "score",
  name: "q0",
  score: 0.75,
  confidence: 0.3,
  probabilities: [
    { value: 0, label: "0", probability: 0.25 },
    { value: 1, label: "1", probability: 0.75 },
  ],
};

describe("OpenAI decisions", () => {
  it("reports malformed JSON as a provider output error", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("{", {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const model = new OpenAIClient({ client: new OpenAI({ apiKey: "test", fetch }) }).decisionModel(
      { modelId: GPT_6_LUNA },
    );
    await expect(
      decide({ model, state: null, questions: { ok: check({ instructions: "True?" }) } }),
    ).rejects.toMatchObject({
      name: "DecisionProviderOutputError",
      provider: "OpenAI",
      modelId: GPT_6_LUNA,
      cause: expect.any(SyntaxError),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("maps mixed questions, preserves confidence and raw SDK metadata, and protects reserved fields", async () => {
    const raw = fixture([
      { ...choiceAnswer, name: "q0" },
      { type: "predicate", name: "q1_0", probability: 0.8 },
      { type: "predicate", name: "q1_1", probability: 0.7 },
      { ...scoreAnswer, name: "q2", probabilities: [...scoreAnswer.probabilities].reverse() },
      { type: "predicate", name: "q3", probability: 0.9 },
    ]);
    const { client, fetch } = clientWithResponse(raw);
    const model = client.decisionModel({ modelId: GPT_6_LUNA });
    const result = await decide({
      model,
      state: { ticket: "Refund my duplicate payment." },
      providerOptions: {
        model: "override",
        input: "override",
        questions: [],
        safety_identifier: "customer-1",
      },
      questions: {
        department: pick,
        topics: multiLabel({
          instructions: "Which topics?",
          options: { refund: "Refund request", duplicate: { detail: "Duplicate charge" } },
          threshold: 0.8,
        }),
        severity: rating,
        urgent: check({ instructions: "Urgent?" }),
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/decisions");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      model: GPT_6_LUNA,
      input: '{"ticket":"Refund my duplicate payment."}',
      safety_identifier: "customer-1",
    });
    expect(payload.questions[0]).toEqual({
      type: "choice",
      name: "q0",
      instructions: "Pick",
      choices: [{ value: "a" }, { value: "b", description: "B" }],
    });
    expect(JSON.parse(payload.questions[2].instructions)).toMatchObject({
      label: "duplicate",
      criteria: { detail: "Duplicate charge" },
      instructions: "Which topics?",
    });
    expect(payload.questions[3]).toEqual({
      type: "score",
      name: "q2",
      instructions: "Score",
      levels: [
        { label: "0", description: "Low" },
        { label: "1", description: "High" },
      ],
    });
    expect(payload.questions[4]).toEqual({
      type: "predicate",
      name: "q3",
      instructions: "Urgent?",
    });
    expect(result.answers.department).toEqual({
      type: "choice",
      choice: "a",
      confidence: 0.4,
      probabilities: { a: 0.8, b: 0.2 },
    });
    expect(result.answers.topics).toEqual({
      type: "multi-label",
      labels: ["refund"],
      probabilities: { refund: 0.8, duplicate: 0.7 },
    });
    expect(result.answers.severity).toEqual({
      type: "score",
      score: 0.75,
      confidence: 0.3,
      rubric: ["Low", "High"],
      probabilities: [0.25, 0.75],
    });
    expect(result.answers.urgent.probability).toBe(0.9);
    expect(result.rawResponse).toMatchObject(raw);
    expect(result.rawResponse).toHaveProperty("_request_id", "req-test");
    expect(result.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
      details: { output_reasoning_tokens: 1 },
    });
    expect(model.capabilities.questionSupport).toEqual({
      check: "native",
      choice: "native",
      score: "native",
      "multi-label": "composed",
    });
    expect(openai.GPT_6_LUNA).toBe(GPT_6_LUNA);
    expectTypeOf(GPT_6_LUNA).toMatchTypeOf<OpenAIDecisionModelId>();
    expectTypeOf(result.answers.department.choice).toEqualTypeOf<"a" | "b">();
  });

  it.each(["text", null, true, 42, ["record", 2], { record: { active: true } }])(
    "encodes JSON state without changing plain text: %j",
    async (state) => {
      const { client, fetch } = clientWithResponse(
        fixture([{ type: "predicate", name: "q0", probability: 0.5 }]),
      );
      await decide({
        model: client.decisionModel({ modelId: GPT_6_LUNA }),
        state,
        questions: { ok: check({ instructions: "True?" }) },
      });
      expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).input).toBe(
        typeof state === "string" ? state : JSON.stringify(state),
      );
    },
  );

  it("preserves structured rubric criteria and names that collide with object prototypes", async () => {
    const { client, fetch } = clientWithResponse(fixture([scoreAnswer]));
    const rubric = [{ flags: [true, false] }, null] as const;
    const questions = Object.fromEntries([["__proto__", score({ instructions: "Rate", rubric })]]);
    const result = await decide({
      model: client.decisionModel({ modelId: "custom-decision" }),
      state: null,
      questions,
    });
    expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
    expect(result.answers["__proto__"]).toMatchObject({ rubric });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).questions[0].levels).toEqual([
      { label: "0", description: '{"flags":[true,false]}' },
      { label: "1" },
    ]);
  });

  it.each([
    [check({ instructions: "True?" }), []],
    [check({ instructions: "True?" }), [{ type: "predicate", name: null, probability: 0.5 }]],
    [check({ instructions: "True?" }), [{ type: "predicate", name: "extra", probability: 0.5 }]],
    [
      check({ instructions: "True?" }),
      [
        { type: "predicate", name: "q0", probability: 0.5 },
        { type: "predicate", name: "q0", probability: 0.5 },
      ],
    ],
    [check({ instructions: "True?" }), [{ type: "predicate", name: "q0", probability: 1.1 }]],
    [pick, [{ ...choiceAnswer, choice: true }]],
    [pick, [{ ...choiceAnswer, confidence: -0.1 }]],
    [
      pick,
      [
        {
          ...choiceAnswer,
          probabilities: [
            { value: "a", probability: 0.5 },
            { value: "a", probability: 0.5 },
          ],
        },
      ],
    ],
    [pick, [{ ...choiceAnswer, probabilities: [{ value: "a", probability: 1 }] }]],
    [
      pick,
      [
        {
          ...choiceAnswer,
          probabilities: [
            { value: "a", probability: 0.8 },
            { value: "b", probability: 0.8 },
          ],
        },
      ],
    ],
    [rating, [{ ...scoreAnswer, score: 2 }]],
    [
      rating,
      [
        {
          ...scoreAnswer,
          probabilities: [
            { value: 0, label: "wrong", probability: 0.25 },
            { value: 1, label: "1", probability: 0.75 },
          ],
        },
      ],
    ],
    [
      rating,
      [
        {
          ...scoreAnswer,
          probabilities: [
            { value: 0, label: "0", probability: 0.5 },
            { value: 0, label: "0", probability: 0.5 },
          ],
        },
      ],
    ],
    [rating, [{ ...scoreAnswer, probabilities: [{ value: 0.5, label: "0.5", probability: 1 }] }]],
    [rating, [{ ...scoreAnswer, probabilities: [{ value: 0, label: "0", probability: 0.25 }] }]],
  ] as const)("rejects malformed native decision answers", async (question, answers) => {
    const { client } = clientWithResponse(fixture(answers));
    await expect(
      decide({
        model: client.decisionModel({ modelId: GPT_6_LUNA }),
        state: null,
        questions: { rating: question },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it.each([
    {},
    { answers: {} },
    {
      ...fixture([{ type: "predicate", name: "q0", probability: 0.5 }]),
      usage: { input_tokens: -1 },
    },
    {
      ...fixture([{ type: "predicate", name: "q0", probability: 0.5 }]),
      usage: { ...fixture([]).usage, total_tokens: 999 },
    },
    {
      ...fixture([{ type: "predicate", name: "q0", probability: 0.5 }]),
      usage: {
        ...fixture([]).usage,
        input_tokens_details: { cached_tokens: 13, cache_write_tokens: 0 },
      },
    },
  ])("rejects invalid envelopes and usage", async (raw) => {
    const { client } = clientWithResponse(raw);
    await expect(
      decide({
        model: client.decisionModel({ modelId: GPT_6_LUNA }),
        state: null,
        questions: { ok: check({ instructions: "True?" }) },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it("reports refused application question names, preserves the response, and does not retry refusals by default", async () => {
    const raw = fixture([
      { type: "predicate", name: "q0", probability: 0.9 },
      { type: "refusal", name: "q1_0" },
      { type: "refusal", name: "q1_1" },
      { type: "refusal", name: "q2" },
    ]);
    const { client, fetch } = clientWithResponse(raw);
    const error = await decide({
      model: client.decisionModel({ modelId: GPT_6_LUNA }),
      state: "ticket",
      questions: {
        ok: check({ instructions: "True?" }),
        labels: multiLabel({ instructions: "Which?", options: { a: null, b: null } }),
        rating,
      },
      retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DecisionRefusalError);
    expect(error).toMatchObject({
      provider: "OpenAI",
      modelId: GPT_6_LUNA,
      questionNames: ["labels", "rating"],
      rawResponse: raw,
    });
    expect(Object.isFrozen((error as DecisionRefusalError).questionNames)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("records refusal failures separately from completed batch inputs", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)).input;
      return Response.json(
        fixture([
          {
            name: "q0",
            ...(input === "refuse" ? { type: "refusal" } : { type: "predicate", probability: 0.8 }),
          },
        ]),
      );
    });
    const model = new OpenAIClient({ client: new OpenAI({ apiKey: "test", fetch }) }).decisionModel(
      { modelId: GPT_6_LUNA },
    );
    const questions = { ok: check({ instructions: "True?" }) };
    const result = await decideBatch({
      model,
      concurrency: 2,
      inputs: [
        { state: "refuse", questions },
        { state: "ok", questions },
      ],
    });
    expect(result.items[0]).toMatchObject({
      index: 0,
      status: "failed",
      error: { name: "DecisionRefusalError" },
    });
    expect(result.items[1]).toMatchObject({
      index: 1,
      status: "completed",
      result: { answers: { ok: { probability: 0.8 } } },
    });
  });

  it("checks choice limits before network work and rejects blank model IDs", async () => {
    const { client, fetch } = clientWithResponse({});
    const model = client.decisionModel({ modelId: GPT_6_LUNA });
    for (const options of [
      { a: null },
      Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`c${i}`, null])),
    ]) {
      await expect(
        decide({
          model,
          state: null,
          questions: { pick: choice({ instructions: "Pick", options }) },
        }),
      ).rejects.toThrow(RangeError);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(() => client.decisionModel({ modelId: " " })).toThrow(TypeError);
  });

  it("uses injected endpoint and headers and keeps SDK retries disabled", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json(fixture([{ type: "predicate", name: "q0", probability: 0.8 }])),
      );
    const sdk = new OpenAI({
      apiKey: "test-key",
      baseURL: "https://gateway.example/v1",
      defaultHeaders: { "X-App": "test" },
      fetch,
      maxRetries: 4,
    });
    const model = new OpenAIClient({ client: sdk }).decisionModel({ modelId: GPT_6_LUNA });
    await decide({
      model,
      state: null,
      questions: { ok: check({ instructions: "True?" }) },
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://gateway.example/v1/decisions");
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("X-App")).toBe("test");
  });

  it("does not use SDK retries when core retries are disabled", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 503 }));
    const model = new OpenAIClient({
      client: new OpenAI({ apiKey: "test-key", fetch, maxRetries: 4 }),
    }).decisionModel({ modelId: GPT_6_LUNA });
    await expect(
      decide({ model, state: null, questions: { ok: check({ instructions: "True?" }) } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses managed endpoint and headers for decision calls", async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json(fixture([{ type: "predicate", name: "q0", probability: 0.8 }])),
    );
    vi.stubGlobal("fetch", fetch);
    const model = new OpenAIClient({
      apiKey: "test-key",
      baseUrl: "https://managed.example/v1",
      headers: { "X-App": "managed" },
    }).decisionModel({ modelId: GPT_6_LUNA });
    await decide({ model, state: null, questions: { ok: check({ instructions: "True?" }) } });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://managed.example/v1/decisions");
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(headers.get("X-App")).toBe("managed");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
  });

  it("retries generic SDK connection failures through core", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        Response.json(fixture([{ type: "predicate", name: "q0", probability: 0.8 }])),
      );
    const model = new OpenAIClient({
      client: new OpenAI({ apiKey: "test", fetch, maxRetries: 4 }),
    }).decisionModel({ modelId: GPT_6_LUNA });
    const result = await decide({
      model,
      state: null,
      questions: { ok: check({ instructions: "True?" }) },
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    expect(result.answers.ok.probability).toBe(0.8);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries SDK timeouts without confusing internal aborts with caller cancellation", async () => {
    const fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timeout", "AbortError")),
            { once: true },
          );
        }),
    );
    const model = new OpenAIClient({
      client: new OpenAI({ apiKey: "test", fetch, timeout: 5, maxRetries: 4 }),
    }).decisionModel({ modelId: GPT_6_LUNA });
    await expect(
      decide({
        model,
        state: null,
        questions: { ok: check({ instructions: "True?" }) },
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      providerError: expect.any(OpenAI.APIConnectionTimeoutError),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("propagates caller cancellation and prevents retries", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Cancelled", "AbortError");
    });
    const model = new OpenAIClient({
      client: new OpenAI({ apiKey: "test-key", fetch }),
    }).decisionModel({ modelId: GPT_6_LUNA });
    await expect(
      decide({
        model,
        state: null,
        questions: { ok: check({ instructions: "True?" }) },
        abortSignal: controller.signal,
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
