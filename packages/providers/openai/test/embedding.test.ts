import { describe, expect, it } from "vitest";
import { OpenAIClient } from "../src/index";

describe("OpenAI embedding models", () => {
  it("maps OpenAI embedding requests", async () => {
    const client = mockOpenAIClient();
    const model = new OpenAIClient({ client: client as never }).embeddingModel("embed-a", {
      dimensions: 3,
      user: "u1",
    });

    await expect(model.embedTexts(["a", "b"])).resolves.toHaveLength(2);
    expect(client.embeddings.createCalls[0]).toMatchObject({
      model: "embed-a",
      input: ["a", "b"],
      dimensions: 3,
      user: "u1",
    });
  });

  it("maps OpenAI-compatible embedding requests", async () => {
    const compatibleClient = mockOpenAIClient();

    await new OpenAIClient({ client: compatibleClient as never })
      .embeddingModel("compatible-embed")
      .embedTexts(["hello"]);

    expect(compatibleClient.embeddings.createCalls[0]).toMatchObject({
      model: "compatible-embed",
      input: ["hello"],
    });
  });
});

function mockOpenAIClient() {
  const createCalls: unknown[] = [];
  return {
    embeddings: {
      createCalls,
      async create(params: { input: string[] }) {
        createCalls.push(params);
        return {
          data: params.input.map((text, index) => ({
            index,
            embedding: [index, text.length],
          })),
        };
      },
    },
  };
}
