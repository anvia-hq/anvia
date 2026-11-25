import { describe, expect, it } from "vitest";
import { MistralClient } from "../src/index";

describe("Mistral embedding models", () => {
  it("maps Mistral embedding requests, batches inputs, and preserves order", async () => {
    const calls: unknown[] = [];
    const client = new MistralClient({
      client: {
        embeddings: {
          create: async (params: { inputs: string[] }) => {
            calls.push(params);

            if (params.inputs.length === 2) {
              return {
                data: [
                  { index: 1, embedding: [2, 0] },
                  { index: 0, embedding: [1, 0] },
                ],
              };
            }

            return {
              data: [{ index: 0, embedding: [params.inputs[0]?.length ?? 0, 0] }],
            };
          },
        },
      } as never,
    });

    const embeddings = await client
      .embeddingModel({
        modelId: "mistral-embed-test",
        dimensions: 8,
        maxBatchSize: 2,
      })
      .embedTexts(["a", "bb", "ccc"]);

    expect(calls).toEqual([
      { model: "mistral-embed-test", inputs: ["a", "bb"], outputDimension: 8 },
      { model: "mistral-embed-test", inputs: ["ccc"], outputDimension: 8 },
    ]);
    expect(embeddings).toEqual([
      { document: "a", vector: [1, 0] },
      { document: "bb", vector: [2, 0] },
      { document: "ccc", vector: [3, 0] },
    ]);
  });

  it("returns no embeddings for empty input", async () => {
    const client = new MistralClient({
      client: {
        embeddings: {
          create: async () => {
            throw new Error("The provider should not be called for empty input.");
          },
        },
      } as never,
    });

    await expect(
      client.embeddingModel({ modelId: "mistral-embed" }).embedTexts([]),
    ).resolves.toEqual([]);
  });

  it("validates Mistral embedding response length", async () => {
    const client = new MistralClient({
      client: {
        embeddings: {
          create: async () => ({ data: [{ index: 0, embedding: [1] }] }),
        },
      } as never,
    });

    await expect(
      client.embeddingModel({ modelId: "mistral-embed" }).embedTexts(["a", "b"]),
    ).rejects.toThrow("Embedding response length 1 did not match input length 2");
  });

  it("rejects duplicate embedding response indexes with the Mistral label", async () => {
    const client = new MistralClient({
      client: {
        embeddings: {
          create: async () => ({
            data: [
              { index: 0, embedding: [1] },
              { index: 0, embedding: [2] },
            ],
          }),
        },
      } as never,
    });

    await expect(
      client.embeddingModel({ modelId: "mistral-embed" }).embedTexts(["a", "b"]),
    ).rejects.toThrow("Duplicate Mistral embedding response index 0.");
  });
});
