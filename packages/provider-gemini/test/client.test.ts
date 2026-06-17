import { describe, expect, it } from "vitest";
import { toGoogleGenAIOptions } from "../src/gemini/client";
import { GeminiClient, GeminiCompletionModel, GeminiEmbeddingModel } from "../src/index";

describe("GeminiClient", () => {
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
