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
