import type { ModelListingError } from "@anvia/core/model-listing";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GROK_4_3,
  GrokChatCompletionModel,
  GrokClient,
  type GrokCompletionModelName,
  GrokImageGenerationModel,
  type GrokImageGenerationModelName,
  GrokResponsesCompletionModel,
  XAI_BASE_URL,
} from "../src/index";

describe("GrokClient", () => {
  it("types known Grok models while accepting custom model strings", () => {
    const client = new GrokClient({ client: fakeSdk() as never });

    expectTypeOf(
      client.completionModel("grok-4.3").defaultModel,
    ).toEqualTypeOf<GrokCompletionModelName>();
    client.completionModel("custom-grok-model");

    expectTypeOf(
      client.imageGenerationModel("grok-imagine-image").defaultModel,
    ).toEqualTypeOf<GrokImageGenerationModelName>();
    client.imageGenerationModel("custom-grok-image-model");
  });

  it("validates explicit Grok credentials", () => {
    expect(() => new GrokClient()).toThrow("Missing Grok credentials");
  });

  it("targets xAI by default", () => {
    const client = new GrokClient({ apiKey: "key" });

    expect((client.client as unknown as { baseURL?: string }).baseURL).toBe(XAI_BASE_URL);
  });

  it("passes custom fetch to the SDK client", () => {
    const fetchFn = (async () => new Response()) as typeof fetch;
    const client = new GrokClient({ apiKey: "key", fetch: fetchFn });

    expect((client.client as unknown as { fetch?: typeof fetch }).fetch).toBe(fetchFn);
  });

  it("creates Responses completion models by default", () => {
    const client = new GrokClient({ client: fakeSdk() as never });
    const model = client.completionModel();

    expect(model).toBeInstanceOf(GrokResponsesCompletionModel);
    expect(model.defaultModel).toBe(GROK_4_3);
  });

  it("creates Chat completion models when requested", () => {
    const client = new GrokClient({
      client: fakeSdk() as never,
      completionApi: "chat",
    });
    const model = client.completionModel("grok-chat-test");

    expect(model).toBeInstanceOf(GrokChatCompletionModel);
    expect(model.defaultModel).toBe("grok-chat-test");
  });

  it("creates image generation models", () => {
    const client = new GrokClient({ client: fakeSdk() as never });

    expect(client.imageGenerationModel()).toBeInstanceOf(GrokImageGenerationModel);
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

  it("wraps unexpected model listing payloads", async () => {
    const client = new GrokClient({
      client: {
        models: {
          list: async () => ({ unexpected: [] }),
        },
      } as never,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      name: "ModelListingError",
      provider: "grok",
    } satisfies Partial<ModelListingError>);
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
