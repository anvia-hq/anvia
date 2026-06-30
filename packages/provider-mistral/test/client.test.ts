import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MistralClient,
  MistralCompletionModel,
  type MistralCompletionModelName,
  MistralEmbeddingModel,
  MistralOcrModel,
  type MistralOcrModelName,
} from "../src/index";

describe("MistralClient", () => {
  it("types known Mistral models while accepting custom model strings", () => {
    const client = new MistralClient({ client: fakeSdk() as never });

    expectTypeOf(
      client.completionModel("mistral-large-latest").defaultModel,
    ).toEqualTypeOf<MistralCompletionModelName>();
    client.completionModel("custom-mistral-model");

    client.embeddingModel("mistral-embed");
    client.embeddingModel("custom-mistral-embedding");

    expectTypeOf(
      client.ocrModel("mistral-ocr-latest").defaultModel,
    ).toEqualTypeOf<MistralOcrModelName>();
    client.ocrModel("custom-mistral-ocr");
  });

  it("validates explicit Mistral credentials", () => {
    expect(() => new MistralClient()).toThrow(
      "Missing Mistral credentials. Pass apiKey when constructing MistralClient.",
    );
  });

  it("creates completion, embedding, and OCR models with an injected SDK client", () => {
    const client = new MistralClient({ client: fakeSdk() as never });

    expect(client.completionModel()).toBeInstanceOf(MistralCompletionModel);
    expect(client.embeddingModel()).toBeInstanceOf(MistralEmbeddingModel);
    expect(client.ocrModel()).toBeInstanceOf(MistralOcrModel);
  });

  it("lists models from the Mistral SDK", async () => {
    const client = new MistralClient({
      client: {
        models: {
          list: async () => ({
            data: [
              {
                id: "mistral-large-latest",
                name: "Mistral Large",
                description: "Large model.",
                created: 1_700_000_000,
                ownedBy: "mistralai",
                maxContextLength: 128_000,
                type: "base",
              },
            ],
          }),
        },
      } as never,
    });

    await expect(client.listModels()).resolves.toEqual({
      data: [
        {
          id: "mistral-large-latest",
          name: "Mistral Large",
          description: "Large model.",
          type: "base",
          createdAt: 1_700_000_000,
          ownedBy: "mistralai",
          contextLength: 128_000,
        },
      ],
    });
  });
});

function fakeSdk() {
  return {
    chat: {
      complete: async () => ({}),
      stream: async function* () {},
    },
    embeddings: {
      create: async () => ({ data: [] }),
    },
    files: {
      upload: async () => ({ id: "file-test" }),
    },
    ocr: {
      process: async () => ({}),
    },
  };
}
