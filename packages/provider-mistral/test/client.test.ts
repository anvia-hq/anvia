import { describe, expect, it } from "vitest";
import { MistralClient, MistralCompletionModel, MistralEmbeddingModel } from "../src/index";

describe("MistralClient", () => {
  it("validates explicit Mistral credentials", () => {
    expect(() => new MistralClient()).toThrow(
      "Missing Mistral credentials. Pass apiKey when constructing MistralClient.",
    );
  });

  it("creates completion and embedding models with an injected SDK client", () => {
    const client = new MistralClient({ client: fakeSdk() as never });

    expect(client.completionModel()).toBeInstanceOf(MistralCompletionModel);
    expect(client.embeddingModel()).toBeInstanceOf(MistralEmbeddingModel);
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
  };
}
