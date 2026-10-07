import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  check,
  choice,
  decide,
  DecisionProviderOutputError,
  multiLabel,
  score,
} from "@anvia/core/decision";
import { ModelListingError } from "@anvia/core/model-listing";
import { JevClient, JEV_LATEST, jev } from "../src/index";

function fixture(answers: unknown) {
  return { model: "jev-test", answers, usage: { input_tokens: 12, output_tokens: 3 } };
}

function clientWithResponse(response: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } }),
  );
  const sdk = new TypeSafeClient({
    apiKey: "test-key",
    fetch,
    retry: { maxRetries: 4 },
    logLevel: "off",
  });
  return { client: new JevClient({ client: sdk }), sdk, fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Jev decisions", () => {
  it("maps all question types in one SDK request and preserves provider confidence and raw response", async () => {
    const raw = fixture({
      q0: {
        type: "choice",
        choice: "billing",
        confidence: 0.4,
        probabilities: { billing: 0.8, other: 0.2 },
      },
      q1_0: { type: "noul", noul: 0.8 },
      q1_1: { type: "noul", noul: 0.7 },
      q2: {
        type: "score",
        score: 0.75,
        confidence: 0.3,
        probabilities: { "0": 0.25, "1": 0.75 },
        legend: { "0": "Low", "1": "High" },
      },
      q3: { type: "noul", noul: 0.9 },
    });
    const { client, fetch } = clientWithResponse(raw);
    const model = client.decisionModel({ modelId: JEV_LATEST });
    const result = await decide({
      model,
      state: { ticket: "Refund my duplicate payment." },
      providerOptions: { model: "override", state: "override", questions: {}, custom: "value" },
      questions: {
        department: choice({
          instructions: "Which team?",
          options: { billing: null, other: null },
        }),
        topics: multiLabel({
          instructions: "Which topics?",
          options: { refund: "Refund request", duplicate: "Duplicate charge" },
          threshold: 0.8,
        }),
        severity: score({ instructions: "How severe?", rubric: ["Low", "High"] }),
        urgent: check({ instructions: "Urgent?" }),
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe(JEV_LATEST);
    expect(payload.state).toEqual({ ticket: "Refund my duplicate payment." });
    expect(payload.custom).toBe("value");
    expect(payload.questions.q0).toEqual({
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: null, other: null },
    });
    expect(payload.questions.q1_0).toMatchObject({
      type: "noul",
      instructions: { label: "refund", instructions: "Which topics?" },
      criteria: { true: "Refund request" },
    });
    expect(payload.questions.q2).toEqual({
      type: "score",
      instructions: "How severe?",
      criteria: ["Low", "High"],
    });
    expect(payload.questions.q3).toEqual({ type: "noul", instructions: "Urgent?" });
    expect(result.answers.department.confidence).toBe(0.4);
    expect(result.answers.topics).toEqual({
      type: "multi-label",
      labels: ["refund"],
      probabilities: { refund: 0.8, duplicate: 0.7 },
    });
    expect(result.answers.severity.probabilities).toEqual([0.25, 0.75]);
    expect(result.answers.urgent.probability).toBe(0.9);
    expect(result.rawResponse).toEqual(raw);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(model.capabilities.questionSupport["multi-label"]).toBe("composed");
    expect(jev.JevClient).toBe(JevClient);
  });

  it("supports scalar state and question names that collide with object prototypes", async () => {
    const { client, fetch } = clientWithResponse(fixture({ q0: { type: "noul", noul: 0.5 } }));
    const questions = Object.fromEntries([["__proto__", check({ instructions: "True?" })]]);
    const result = await decide({
      model: client.decisionModel({ modelId: "custom-jev" }),
      state: true,
      questions,
    });
    expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).state).toEqual({ value: true });
  });

  it.each([
    fixture({}),
    fixture({ q0: { type: "noul", noul: 1.1 } }),
    fixture({ q0: { type: "choice", choice: "yes" } }),
    { answers: { q0: { type: "noul", noul: 0.8 } }, usage: { input_tokens: -1, output_tokens: 0 } },
    { unexpected: true },
  ])("rejects malformed SDK responses with a typed provider output error", async (raw) => {
    const { client } = clientWithResponse(raw);
    await expect(
      decide({
        model: client.decisionModel({ modelId: JEV_LATEST }),
        state: null,
        questions: { urgent: check({ instructions: "Urgent?" }) },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it("rejects invalid choice and score distributions", async () => {
    const { client } = clientWithResponse(
      fixture({
        q0: { type: "choice", choice: "a", confidence: 0.5, probabilities: { a: 0.8, b: 0.8 } },
      }),
    );
    await expect(
      decide({
        model: client.decisionModel({ modelId: JEV_LATEST }),
        state: null,
        questions: { pick: choice({ instructions: "Pick", options: { a: null, b: null } }) },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
    const badScore = clientWithResponse(
      fixture({
        q0: { type: "score", score: 2, confidence: 0.5, probabilities: { "0": 0.5, "1": 0.5 } },
      }),
    );
    await expect(
      decide({
        model: badScore.client.decisionModel({ modelId: JEV_LATEST }),
        state: null,
        questions: { rating: score({ instructions: "Score", rubric: ["Low", "High"] }) },
      }),
    ).rejects.toBeInstanceOf(DecisionProviderOutputError);
  });

  it("disables SDK retries even for injected clients and lets core own retry behavior", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture({ q0: { type: "noul", noul: 0.8 } }))),
      );
    const sdk = new TypeSafeClient({
      apiKey: "test-key",
      fetch,
      retry: { maxRetries: 4 },
      logLevel: "off",
    });
    const model = new JevClient({ client: sdk }).decisionModel({ modelId: JEV_LATEST });
    await decide({
      model,
      state: "ticket",
      questions: { urgent: check({ instructions: "Urgent?" }) },
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("propagates cancellation through the SDK and normalizes abort errors", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    });
    const model = new JevClient({
      client: new TypeSafeClient({ apiKey: "test-key", fetch, logLevel: "off" }),
    }).decisionModel({ modelId: JEV_LATEST });
    await expect(
      decide({
        model,
        state: null,
        questions: { urgent: check({ instructions: "Urgent?" }) },
        abortSignal: controller.signal,
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries SDK timeouts without treating their internal abort as caller cancellation", async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timeout", "AbortError")),
            {
              once: true,
            },
          );
        }),
    );
    const model = new JevClient({
      client: new TypeSafeClient({ apiKey: "test-key", fetch, timeout: 5, logLevel: "off" }),
    }).decisionModel({ modelId: JEV_LATEST });
    await expect(
      decide({
        model,
        state: null,
        questions: { urgent: check({ instructions: "Urgent?" }) },
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({ name: "TimeoutError", providerError: { name: "APITimeoutError" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("Jev client", () => {
  it("uses explicit credentials, endpoint and headers, and supports the environment key", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture({ q0: { type: "noul", noul: 0.2 } }))),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("TYPESAFE_API_KEY", "environment-key");
    const client = new JevClient({
      baseUrl: "https://jev.example/v1-root",
      headers: { "X-App": "test" },
    });
    await decide({
      model: client.decisionModel({ modelId: JEV_LATEST }),
      state: null,
      questions: { urgent: check({ instructions: "Urgent?" }) },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://jev.example/v1-root/v1/systemone");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer environment-key",
      "X-App": "test",
    });
  });

  it("rejects blank credentials, model ids, and mixed injection options", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(() => new JevClient({})).toThrow(TypeError);
    expect(() => new JevClient({ apiKey: " " })).toThrow(TypeError);
    const { client, sdk } = clientWithResponse({});
    expect(() => client.decisionModel({ modelId: " " })).toThrow(TypeError);
    expect(() => new JevClient({ client: sdk, apiKey: "key" } as never)).toThrow(TypeError);
  });

  it("lists models with normalized metadata", async () => {
    const { client, fetch } = clientWithResponse({
      models: [{ name: "jev-1", description: "Decision model", release_date: "2026-09-15" }],
    });
    expect(await client.listModels()).toEqual({
      data: [{ id: "jev-1", name: "jev-1", description: "Decision model", type: "decision" }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("wraps invalid model metadata and listing transport failures", async () => {
    const { client } = clientWithResponse({ models: [{ name: 3 }] });
    await expect(client.listModels()).rejects.toBeInstanceOf(ModelListingError);
  });
});
