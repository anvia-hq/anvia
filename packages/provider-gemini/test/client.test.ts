import { describe, expect, expectTypeOf, it } from "vitest";
import { toGoogleGenAIOptions } from "../src/gemini/client";
import {
  GeminiClient,
  GeminiCompletionModel,
  type GeminiCompletionModelName,
  GeminiEmbeddingModel,
  type GeminiImageGenerationModelName,
  type GeminiTranscriptionModelName,
} from "../src/index";

describe("GeminiClient", () => {
  it("types known Gemini models while accepting custom model strings", () => {
    const client = new GeminiClient({ client: fakeSdk() as never });

    expectTypeOf(
      client.completionModel("gemini-2.5-flash").defaultModel,
    ).toEqualTypeOf<GeminiCompletionModelName>();
    client.completionModel("custom-gemini-model");

    client.embeddingModel("gemini-embedding-001");
    client.embeddingModel("custom-gemini-embedding");

    expectTypeOf(
      client.imageGenerationModel("gemini-2.5-flash-image").defaultModel,
    ).toEqualTypeOf<GeminiImageGenerationModelName>();
    client.imageGenerationModel("custom-gemini-image");
    client.imagenGenerationModel("imagen-4.0-generate-001");

    expectTypeOf(
      client.transcriptionModel("gemini-2.5-flash").defaultModel,
    ).toEqualTypeOf<GeminiTranscriptionModelName>();
    client.transcriptionModel("custom-gemini-transcription");
  });

  it("creates Gemini API SDK options from explicit apiKey", () => {
    expect(toGoogleGenAIOptions({ apiKey: "key" })).toEqual({ apiKey: "key" });
  });

  it("creates Vertex AI SDK options from explicit project and location", () => {
    expect(
      toGoogleGenAIOptions({ vertexai: true, project: "project", location: "us-central1" }),
    ).toEqual({
      vertexai: true,
      project: "project",
      location: "us-central1",
    });
  });

  it("validates explicit Gemini and Vertex credentials", () => {
    expect(() => new GeminiClient()).toThrow("Missing Gemini apiKey");
    expect(() => new GeminiClient({ vertexai: true, project: "project" })).toThrow(
      "Missing Vertex Gemini location",
    );
    expect(() => new GeminiClient({ vertexai: true, location: "us-central1" })).toThrow(
      "Missing Vertex Gemini project",
    );
  });

  it("creates completion and embedding models with an injected SDK client", () => {
    const client = new GeminiClient({ client: fakeSdk() as never });

    expect(client.completionModel()).toBeInstanceOf(GeminiCompletionModel);
    expect(client.embeddingModel()).toBeInstanceOf(GeminiEmbeddingModel);
  });

  it("lists models from the Gemini SDK", async () => {
    const client = new GeminiClient({
      client: {
        models: {
          list: async () =>
            asyncIterable([
              {
                name: "models/gemini-2.5-flash",
                displayName: "Gemini 2.5 Flash",
                description: "Fast Gemini model.",
                inputTokenLimit: 1_048_576,
              },
            ]),
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
