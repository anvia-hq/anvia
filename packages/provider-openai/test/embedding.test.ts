import { describe, expect, it } from "vitest";
import { OpenAIClient } from "../src/index";

describe("OpenAI embedding models", () => {
  it("maps OpenAI embedding requests", async () => {
    const client = mockOpenAIClient();
    const model = new OpenAIClient({ client: client as never }).embeddingModel({
      modelId: "embed-a",
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

  it("maps out-of-order embedding response rows to their original input texts", async () => {
    const client = mockOpenAIClient({
      embeddingResponse: {
        data: [
          { index: 2, embedding: [20] },
          { index: 0, embedding: [0] },
          { index: 1, embedding: [10] },
        ],
      },
    });

    await expect(
      new OpenAIClient({ client: client as never })
        .embeddingModel({ modelId: "embed-a" })
        .embedTexts(["first", "second", "third"]),
    ).resolves.toEqual([
      { document: "first", vector: [0] },
      { document: "second", vector: [10] },
      { document: "third", vector: [20] },
    ]);
  });

  it("rejects mismatched embedding response length", async () => {
    const client = {
      embeddings: {
        create: async () => null,
      },
    };

    await expect(
      new OpenAIClient({ client: client as never })
        .embeddingModel({ modelId: "embed-a" })
        .embedTexts(["first"]),
    ).rejects.toThrow("Embedding response length 0 did not match input length 1");
  });
});

function mockOpenAIClient(options: { embeddingResponse?: unknown } = {}) {
  const createCalls: unknown[] = [];
  return {
    embeddings: {
      createCalls,
      async create(params: { input: string[] }) {
        createCalls.push(params);
        return (
          options.embeddingResponse ?? {
            data: params.input.map((text, index) => ({
              index,
              embedding: [index, text.length],
            })),
          }
        );
      },
    },
  };
}
