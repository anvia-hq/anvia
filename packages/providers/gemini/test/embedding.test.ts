import { describe, expect, it } from "vitest";
import { GeminiClient } from "../src/index";

describe("Gemini embedding models", () => {
  it("maps Gemini embedding requests and preserves order", async () => {
    const calls: unknown[] = [];
    const client = new GeminiClient({
      client: {
        models: {
          embedContent: async (params: unknown) => {
            calls.push(params);
            return {
              embeddings: [{ values: [1, 2] }, { values: [3, 4] }],
            };
          },
        },
      } as never,
    });

    const embeddings = await client
      .embeddingModel("gemini-embedding-test", {
        dimensions: 32,
        taskType: "RETRIEVAL_DOCUMENT",
        title: "Docs",
        maxBatchSize: 2,
      })
      .embedTexts(["first", "second"]);

    expect(calls).toEqual([
      {
        model: "gemini-embedding-test",
        contents: ["first", "second"],
        config: {
          outputDimensionality: 32,
          taskType: "RETRIEVAL_DOCUMENT",
          title: "Docs",
        },
      },
    ]);
    expect(embeddings).toEqual([
      { document: "first", vector: [1, 2] },
      { document: "second", vector: [3, 4] },
    ]);
  });

  it("validates Gemini embedding response length", async () => {
    const client = new GeminiClient({
      client: {
        models: {
          embedContent: async () => ({ embeddings: [{ values: [1] }] }),
        },
      } as never,
    });

    await expect(client.embeddingModel().embedTexts(["a", "b"])).rejects.toThrow(
      "Embedding response length 1 did not match input length 2",
    );
  });

  it("rejects invalid Gemini embedding response rows", async () => {
    const client = new GeminiClient({
      client: {
        models: {
          embedContent: async () => ({
            embeddings: [{ values: [1, 2] }, { values: [3, "bad"] }],
          }),
        },
      } as never,
    });

    await expect(client.embeddingModel().embedTexts(["a", "b"])).rejects.toThrow(
      "Invalid Gemini embedding response vector at position 1.",
    );
  });

  it("rejects malformed Gemini single embedding responses", async () => {
    const client = new GeminiClient({
      client: {
        models: {
          embedContent: async () => ({ embedding: { values: "bad" } }),
        },
      } as never,
    });

    await expect(client.embeddingModel().embedTexts(["a"])).rejects.toThrow(
      "Invalid Gemini embedding response vector at position 0.",
    );
  });
});
