import type { ModelListingError } from "@anvia/core/model-listing";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GROK_4_5,
  GrokClient,
  type GrokClientOptions,
  type GrokCompletionModelId,
  type GrokImageGenerationModelId,
} from "../src/index";

describe("GrokClient", () => {
  it("rejects mixed injected and managed configuration", () => {
    const mixed = {
      client: fakeSdk() as never,
      http: { apiKey: "key" },
      baseUrl: "https://ignored.example.com",
    };
    expectTypeOf(mixed).not.toMatchTypeOf<GrokClientOptions>();
    expect(() => new GrokClient(mixed as never)).toThrow(
      "GrokClient cannot combine client with baseUrl",
    );
  });

  it("types known Grok models while accepting custom model strings", () => {
    const client = injectedClient(fakeSdk());

    expectTypeOf(
      client.completionModel({ modelId: "grok-4.3", api: "responses" }).modelId,
    ).toEqualTypeOf<string>();
    const completionId: GrokCompletionModelId = "custom-grok-model";
    client.completionModel({ modelId: completionId, api: "chat" });

    expectTypeOf(
      client.imageGenerationModel({ modelId: "grok-imagine-image" }).modelId,
    ).toEqualTypeOf<string | undefined>();
    const imageId: GrokImageGenerationModelId = "custom-grok-image-model";
    client.imageGenerationModel({ modelId: imageId });
  });

  it("validates explicit Grok credentials", () => {
    expect(() => new GrokClient({} as never)).toThrow("Missing Grok credentials");
  });

  it("binds managed clients to explicit model handles", () => {
    const client = new GrokClient({ apiKey: "key" });

    expect(client.completionModel({ modelId: GROK_4_5, api: "responses" }).modelId).toBe(GROK_4_5);
  });

  it("accepts custom transport configuration without exposing the native client", () => {
    const fetchFn = (async () => new Response()) as typeof fetch;
    const client = new GrokClient({ apiKey: "key", fetch: fetchFn });

    expect(client.imageGenerationModel({ modelId: "grok-imagine-image" }).provider).toBe("grok");
  });

  it("creates Responses completion models explicitly", () => {
    const client = injectedClient(fakeSdk());
    const model = client.completionModel({ modelId: GROK_4_5, api: "responses" });

    expect(model.provider).toBe("grok");
    expect(model.modelId).toBe(GROK_4_5);
  });

  it("creates Chat completion models when requested", () => {
    const client = injectedClient(fakeSdk());
    const model = client.completionModel({ modelId: "grok-chat-test", api: "chat" });

    expect(model.provider).toBe("grok");
    expect(model.modelId).toBe("grok-chat-test");
  });

  it("creates image generation models", () => {
    const client = injectedClient(fakeSdk());

    expect(client.imageGenerationModel({ modelId: "grok-imagine-image" }).modelId).toBe(
      "grok-imagine-image",
    );
  });

  it("creates batch speech generation and transcription models", () => {
    const client = injectedClient(fakeSdk());

    expect(client.speechGenerationModel().modelId).toBeUndefined();
    expect(client.transcriptionModel().modelId).toBeUndefined();
  });

  it("lists Grok models", async () => {
    const client = new GrokClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "grok-4.3",
                object: "model",
                created: 1_778_000_000,
                owned_by: "xai",
                context_length: 1_000_000,
              },
            ],
          }),
        },
      } as never,
      http: { apiKey: "key" },
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "grok-4.3",
          type: "model",
          createdAt: 1_778_000_000,
          ownedBy: "xai",
          contextLength: 1_000_000,
        },
      ],
    });
  });

  it("preserves model field precedence across compatible aliases", async () => {
    const client = new GrokClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "grok-compatible",
                type: "preferred-type",
                object: "fallback-type",
                created: 100,
                created_at: 200,
                context_length: 300,
                contextLength: 400,
              },
            ],
          }),
        },
      } as never,
      http: { apiKey: "key" },
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "grok-compatible",
          type: "preferred-type",
          createdAt: 200,
          contextLength: 400,
        },
      ],
    });
  });

  it("returns an empty model list for unexpected model listing payloads", async () => {
    const client = new GrokClient({
      client: {
        models: {
          list: async () => ({ unexpected: [] }),
        },
      } as never,
      http: { apiKey: "key" },
    });

    await expect(client.listModels()).resolves.toEqual({ data: [] });
  });

  it("wraps model listing failures", async () => {
    const client = new GrokClient({
      client: {
        models: {
          list: async () => {
            throw Object.assign(new Error("unauthorized"), { status: 401 });
          },
        },
      } as never,
      http: { apiKey: "key" },
    });

    await expect(client.listModels()).rejects.toMatchObject({
      name: "ModelListingError",
      provider: "grok",
      statusCode: 401,
    } satisfies Partial<ModelListingError>);
  });
});

function fakeSdk() {
  return {
    responses: { create: async () => ({}) },
    chat: { completions: { create: async () => ({}) } },
    images: { generate: async () => ({ data: [] }) },
    models: { list: async () => ({ data: [] }) },
  };
}

function injectedClient(client: ReturnType<typeof fakeSdk>): GrokClient {
  return new GrokClient({
    client: client as never,
    http: { apiKey: "key" },
  });
}
