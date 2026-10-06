import type OpenAI from "openai";
import { AzureOpenAI } from "openai";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { AzureOpenAIClient, type AzureOpenAIClientOptions } from "../src/index";

const endpoint = "https://example.openai.azure.com";
const request = { chatHistory: [], documents: [], tools: [] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function captureFetch(body: unknown) {
  return vi.fn<typeof fetch>(async () => jsonResponse(body));
}

describe("AzureOpenAIClient", () => {
  it("sends deployment names to Azure v1 and defaults to chat", async () => {
    const fetch = captureFetch({
      id: "chat-1",
      choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
      usage: {},
    });
    const client = new AzureOpenAIClient({
      endpoint,
      apiKey: "test-key",
      fetch,
      headers: { "x-project": "test-project" },
    });
    const model = client.completionModel({ modelId: "my-deployment" });
    await model.completion(request);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${endpoint}/openai/v1/chat/completions`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(new Headers(init?.headers).get("x-project")).toBe("test-project");
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: "my-deployment" });
    expect(model.provider).toBe("azure-openai");
    expect(model.traceRequest?.(request)).toMatchObject({ provider: "azure-openai-chat" });
  });

  it("preserves a Foundry project base URL for Responses", async () => {
    const fetch = captureFetch({ id: "resp-1", status: "completed", output: [], usage: {} });
    const client = new AzureOpenAIClient({
      baseUrl: "https://example.services.ai.azure.com/api/projects/demo/openai/v1/",
      azureADTokenProvider: async () => "project-token",
      fetch,
    });
    const model = client.completionModel({ modelId: "deployed-model", api: "responses" });
    await model.completion(request);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://example.services.ai.azure.com/api/projects/demo/openai/v1/responses",
    );
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      "Bearer project-token",
    );
    expect(model.traceRequest?.(request, { stream: true })).toMatchObject({
      provider: "azure-openai-responses",
    });
  });

  it("refreshes Entra tokens for each request", async () => {
    const tokenProvider = vi.fn().mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
    const fetch = captureFetch({ data: [] });
    const client = new AzureOpenAIClient({ endpoint, azureADTokenProvider: tokenProvider, fetch });
    await client.listModels();
    await client.listModels();
    expect(tokenProvider).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization")),
    ).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("rejects empty tokens before sending a request", async () => {
    const fetch = captureFetch({ data: [] });
    const client = new AzureOpenAIClient({
      endpoint,
      azureADTokenProvider: async () => " ",
      fetch,
    });
    await expect(client.listModels()).rejects.toThrow("Azure OpenAI model listing failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts an injected legacy Azure SDK client", async () => {
    const fetch = captureFetch({ data: [{ index: 0, embedding: [1, 2] }] });
    const sdk = new AzureOpenAI({
      baseURL: `${endpoint}/openai`,
      apiKey: "test-key",
      apiVersion: "2024-10-21",
      fetch,
    });
    const model = new AzureOpenAIClient({ client: sdk }).embeddingModel({
      modelId: "embedding-deployment",
    });
    await expect(model.embedTexts(["hello"])).resolves.toEqual([
      { document: "hello", vector: [1, 2] },
    ]);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe("/openai/deployments/embedding-deployment/embeddings");
    expect(url.searchParams.get("api-version")).toBe("2024-10-21");
  });

  it("preserves typed controls and explicit deployment context limits", () => {
    const client = new AzureOpenAIClient({ client: {} as OpenAI });
    const model = client.completionModel({
      modelId: "custom-deployment",
      api: "responses",
      contextLimits: { contextWindow: 10000, maxOutputTokens: 2000 },
      controls: {
        reasoningEffort: { type: "select", label: "Reasoning", options: ["low", "high"] },
      },
    });
    expectTypeOf(model.controls!.reasoningEffort.options).items.toEqualTypeOf<"low" | "high">();
    expect(model.contextLimits).toEqual({ contextWindow: 10000, maxOutputTokens: 2000 });
    expect(
      client.completionModel({ modelId: "gpt-5.1" }).controls?.reasoningEffort.options,
    ).toEqual(["none", "low", "medium", "high"]);
  });

  it("keeps embedding batch settings, order, and Azure identity", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
    const model = new AzureOpenAIClient({
      client: { embeddings: { create } } as never,
    }).embeddingModel({ modelId: "embed", dimensions: 1, maxBatchSize: 1 });
    const abortSignal = new AbortController().signal;
    await expect(model.embedTexts(["one", "two"], { abortSignal })).resolves.toEqual([
      { document: "one", vector: [1] },
      { document: "two", vector: [1] },
    ]);
    expect(model).toMatchObject({ provider: "azure-openai", dimensions: 1, maxBatchSize: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(
      { model: "embed", input: ["two"], dimensions: 1 },
      { signal: abortSignal, maxRetries: 0 },
    );
  });

  it("maps model lists and identifies Azure listing errors", async () => {
    const fetch = captureFetch({ data: [{ id: "deployment", object: "model" }] });
    const client = new AzureOpenAIClient({ endpoint, apiKey: "test-key", fetch });
    await expect(client.listModels()).resolves.toEqual({
      data: [{ id: "deployment", type: "model" }],
    });
    fetch.mockImplementation(async () => new Response("unauthorized", { status: 401 }));
    await expect(client.listModels()).rejects.toMatchObject({
      name: "ModelListingError",
      provider: "azure-openai",
      statusCode: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("routes image, speech, and transcription calls with Azure deployment names", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith("/images/generations")) {
        return jsonResponse({ data: [{ b64_json: "AQI=" }] });
      }
      if (String(url).endsWith("/audio/speech")) {
        return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } });
      }
      return jsonResponse({ text: "Hello" });
    });
    // Declare the mock's Response implementation so the SDK need not probe it with data:,.
    Object.assign(fetch, { Response });
    const client = new AzureOpenAIClient({ endpoint, apiKey: "test-key", fetch });
    const images = client.imageGenerationModel({ modelId: "image-deployment" });
    const speech = client.speechGenerationModel({ modelId: "speech-deployment" });
    const transcription = client.transcriptionModel({ modelId: "transcribe-deployment" });
    const abortSignal = new AbortController().signal;
    const image = await images.imageGeneration(
      { prompt: "A cat", width: 1024, height: 1024 },
      { abortSignal },
    );
    const audio = await speech.speechGeneration(
      { text: "Hello", voice: "alloy", speed: 1 },
      { abortSignal },
    );
    const transcript = await transcription.transcription(
      { data: new Uint8Array([1, 2]), filename: "speech.mp3" },
      { abortSignal },
    );
    expect(image.images[0].data).toEqual(new Uint8Array([1, 2]));
    expect(audio.audio.data).toEqual(new Uint8Array([1, 2]));
    expect(transcript.text).toBe("Hello");
    expect([images.provider, speech.provider, transcription.provider]).toEqual([
      "azure-openai",
      "azure-openai",
      "azure-openai",
    ]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${endpoint}/openai/v1/images/generations`,
      `${endpoint}/openai/v1/audio/speech`,
      `${endpoint}/openai/v1/audio/transcriptions`,
    ]);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).model).toBe("image-deployment");
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).model).toBe("speech-deployment");
    expect((fetch.mock.calls[2]![1]!.body as FormData).get("model")).toBe("transcribe-deployment");
  });

  it("forwards cancellation and disables SDK retries for completions", async () => {
    const create = vi.fn().mockRejectedValue(new Error("cancelled"));
    const client = new AzureOpenAIClient({ client: { responses: { create } } as never });
    const abortSignal = new AbortController().signal;
    await expect(
      client
        .completionModel({ modelId: "deployment", api: "responses" })
        .completion(request, { abortSignal }),
    ).rejects.toThrow("cancelled");
    expect(create).toHaveBeenCalledWith(expect.anything(), { signal: abortSignal, maxRetries: 0 });
  });

  it("rejects mixed configuration in types and at runtime", () => {
    const mixed = { client: {} as OpenAI, apiKey: "ignored" };
    expectTypeOf(mixed).not.toMatchTypeOf<AzureOpenAIClientOptions>();
    expectTypeOf({
      endpoint,
      baseUrl: endpoint,
      apiKey: "key",
    }).not.toMatchTypeOf<AzureOpenAIClientOptions>();
    expectTypeOf({
      endpoint,
      apiKey: "key",
      azureADTokenProvider: async () => "token",
    }).not.toMatchTypeOf<AzureOpenAIClientOptions>();
    expect(() => new AzureOpenAIClient(mixed as never)).toThrow(
      "cannot combine client with apiKey",
    );
  });

  it.each([
    [{ apiKey: "key" }, "exactly one of endpoint or baseUrl"],
    [{ endpoint, baseUrl: endpoint, apiKey: "key" }, "exactly one of endpoint or baseUrl"],
    [{ endpoint }, "exactly one of apiKey or azureADTokenProvider"],
    [
      { endpoint, apiKey: "key", azureADTokenProvider: async () => "token" },
      "exactly one of apiKey",
    ],
    [{ endpoint, apiKey: " " }, "non-empty string"],
    [{ endpoint, azureADTokenProvider: "bad" }, "must be a function"],
    [{ endpoint: `${endpoint}/openai/v1`, apiKey: "key" }, "Use baseUrl"],
    [{ baseUrl: "file:///tmp/test", apiKey: "key" }, "HTTP(S) URL"],
    [{ baseUrl: `${endpoint}/?api-version=test`, apiKey: "key" }, "HTTP(S) URL"],
    [{ baseUrl: "https://user:password@example.com", apiKey: "key" }, "HTTP(S) URL"],
  ])("validates managed options %j", (options, message) => {
    expect(() => new AzureOpenAIClient(options as never)).toThrow(message);
  });
});
