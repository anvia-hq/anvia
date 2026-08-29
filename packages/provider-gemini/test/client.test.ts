import type { GoogleGenAI } from "@google/genai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { toGoogleGenAIOptions } from "../src/gemini/client";
import {
  GeminiClient,
  type GeminiClientOptions,
  type GeminiCompletionModelId,
  type GeminiGenerateContentImageModelId,
  type GeminiGenerateImagesModelId,
  type GeminiTranscriptionModelId,
} from "../src/index";

describe("GeminiClient", () => {
  it("rejects mixed injected and managed configuration", () => {
    const mixed = { client: fakeSdk() as unknown as GoogleGenAI, apiKey: "ignored" };
    expectTypeOf(mixed).not.toMatchTypeOf<GeminiClientOptions>();
    expect(() => new GeminiClient(mixed as never)).toThrow(
      "GeminiClient cannot combine client with apiKey",
    );
  });

  it("types known Gemini models while accepting custom model strings", () => {
    const client = new GeminiClient({ client: fakeSdk() as never });

    expectTypeOf(
      client.completionModel({ modelId: "gemini-2.5-flash" }).modelId,
    ).toEqualTypeOf<string>();
    expectTypeOf("gemini-2.5-flash").toMatchTypeOf<GeminiCompletionModelId>();
    const reasoningModel = client.completionModel({ modelId: "gemini-3.1-pro-preview" });
    expectTypeOf(reasoningModel.controls!.reasoningEffort.options).items.toEqualTypeOf<
      "low" | "medium" | "high"
    >();
    const flash37 = client.completionModel({ modelId: "gemini-3.7-flash" });
    expectTypeOf(flash37.controls!.reasoningEffort.options).items.toEqualTypeOf<
      "low" | "medium" | "high"
    >();
    const liteImage = client.completionModel({ modelId: "gemini-3.1-flash-lite-image" });
    expectTypeOf(liteImage.controls!.reasoningEffort.options).items.toEqualTypeOf<
      "minimal" | "high"
    >();
    client.completionModel({ modelId: "custom-gemini-model" });

    client.embeddingModel({ modelId: "gemini-embedding-001" });
    client.embeddingModel({ modelId: "custom-gemini-embedding" });

    expectTypeOf("gemini-2.5-flash-image").toMatchTypeOf<GeminiGenerateContentImageModelId>();
    expectTypeOf("imagen-4.0-generate-001").toMatchTypeOf<GeminiGenerateImagesModelId>();
    client.imageGenerationModel({ api: "generateContent", modelId: "custom-gemini-image" });
    client.imageGenerationModel({ api: "generateImages", modelId: "imagen-4.0-generate-001" });

    expectTypeOf("gemini-2.5-flash").toMatchTypeOf<GeminiTranscriptionModelId>();
    client.transcriptionModel({ modelId: "custom-gemini-transcription" });
  });

  it("creates Gemini API SDK options from explicit apiKey", () => {
    expect(toGoogleGenAIOptions({ apiKey: "key" })).toEqual({ apiKey: "key" });
  });

  it("creates Vertex AI SDK options from explicit project and location", () => {
    expect(
      toGoogleGenAIOptions({
        vertexAi: { projectId: "project", location: "us-central1" },
      }),
    ).toEqual({
      vertexai: true,
      project: "project",
      location: "us-central1",
    });
  });

  it("forwards explicit Google authentication options to Vertex AI", () => {
    const credentials = {
      client_email: "service-account@example.iam.gserviceaccount.com",
      private_key: "private-key",
    };

    expect(
      toGoogleGenAIOptions({
        vertexAi: {
          projectId: "project",
          location: "us-central1",
          googleAuthOptions: { credentials },
        },
      }),
    ).toEqual({
      vertexai: true,
      project: "project",
      location: "us-central1",
      googleAuthOptions: { credentials },
    });
  });

  it("validates explicit Gemini and Vertex credentials", () => {
    expect(() => new GeminiClient({} as never)).toThrow("Missing Gemini apiKey");
    expect(() => new GeminiClient({ vertexAi: { projectId: "project" } } as never)).toThrow(
      "Missing Vertex Gemini location",
    );
    expect(() => new GeminiClient({ vertexAi: { location: "us-central1" } } as never)).toThrow(
      "Missing Vertex Gemini project",
    );
  });

  it("creates completion and embedding models with an injected SDK client", () => {
    const client = new GeminiClient({ client: fakeSdk() as never });

    expect(client.completionModel({ modelId: "gemini-test" }).modelId).toBe("gemini-test");
    expect(client.embeddingModel({ modelId: "embedding-test" }).modelId).toBe("embedding-test");
  });

  it("lists models from the Gemini SDK", async () => {
    const calls: unknown[] = [];
    const client = new GeminiClient({
      client: {
        models: {
          list: async (params: unknown) => {
            calls.push(params);
            return asyncIterable([
              {
                name: "models/gemini-2.5-flash",
                displayName: "Gemini 2.5 Flash",
                description: "Fast Gemini model.",
                inputTokenLimit: 1_048_576,
              },
            ]);
          },
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          description: "Fast Gemini model.",
          contextLength: 1_048_576,
        },
      ],
    });
    expect(calls).toEqual([
      {
        config: {
          pageSize: 1000,
          httpOptions: { retryOptions: { attempts: 1 } },
        },
      },
    ]);
  });

  it("preserves model field precedence across compatible aliases", async () => {
    const client = new GeminiClient({
      client: {
        models: {
          list: async () =>
            asyncIterable([
              {
                baseModelId: "gemini-compatible",
                displayName: "Display Name",
                display_name: "Preferred Name",
                inputTokenLimit: 100_000,
                input_token_limit: 200_000,
              },
            ]),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "gemini-compatible",
          name: "Preferred Name",
          contextLength: 200_000,
        },
      ],
    });
  });
});

function fakeSdk() {
  return {
    models: {
      generateContent: async () => ({}),
      generateContentStream: async function* () {},
      embedContent: async () => ({ embeddings: [] }),
    },
  };
}

async function* asyncIterable(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item;
  }
}
