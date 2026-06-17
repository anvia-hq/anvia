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
        .embeddingModel("embed-a")
        .embedTexts(["first", "second", "third"]),
    ).resolves.toEqual([
      { document: "first", vector: [0] },
      { document: "second", vector: [10] },
      { document: "third", vector: [20] },
    ]);
  });

  it("rejects duplicate embedding response indexes", async () => {
    const client = mockOpenAIClient({
      embeddingResponse: {
        data: [
          { index: 0, embedding: [0] },
          { index: 0, embedding: [10] },
        ],
      },
    });

    await expect(
      new OpenAIClient({ client: client as never })
        .embeddingModel("embed-a")
        .embedTexts(["first", "second"]),
    ).rejects.toThrow("Embedding response contained duplicate index 0");
  });

  it("rejects missing or out-of-range embedding response indexes", async () => {
    const missingIndexClient = mockOpenAIClient({
      embeddingResponse: {
        data: [
          { index: 0, embedding: [0] },
          { index: 2, embedding: [20] },
        ],
      },
    });

    await expect(
      new OpenAIClient({ client: missingIndexClient as never })
        .embeddingModel("embed-a")
        .embedTexts(["first", "second"]),
    ).rejects.toThrow("Embedding response index 2 was outside input range 0..1");

    const missingRowClient = mockOpenAIClient({
      embeddingResponse: {
        data: [{ index: 0, embedding: [0] }],
      },
    });

    await expect(
      new OpenAIClient({ client: missingRowClient as never })
        .embeddingModel("embed-a")
        .embedTexts(["first", "second"]),
    ).rejects.toThrow("Embedding response length 1 did not match input length 2");
  });

  it("rejects invalid embedding response rows", async () => {
    const invalidIndexClient = mockOpenAIClient({
      embeddingResponse: {
        data: [
          { index: "0", embedding: [0] },
          { index: 1, embedding: [10] },
        ],
      },
    });

    await expect(
      new OpenAIClient({ client: invalidIndexClient as never })
        .embeddingModel("embed-a")
        .embedTexts(["first", "second"]),
    ).rejects.toThrow("Embedding response item 0 contained an invalid index");

    const invalidEmbeddingClient = mockOpenAIClient({
      embeddingResponse: {
        data: [
          { index: 0, embedding: [0] },
          { index: 1, embedding: "not-a-vector" },
        ],
      },
    });

    await expect(
      new OpenAIClient({ client: invalidEmbeddingClient as never })
        .embeddingModel("embed-a")
        .embedTexts(["first", "second"]),
    ).rejects.toThrow("Embedding response item 1 contained an invalid embedding");
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
