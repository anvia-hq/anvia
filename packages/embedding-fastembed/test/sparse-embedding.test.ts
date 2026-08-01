import { describe, expect, it, vi } from "vitest";
import {
  createFastEmbedSparseEmbeddingModel,
  DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL,
  FastEmbedSparseEmbeddingModel,
  type FastEmbedSparseRuntime,
} from "../src/index";

const initMock = vi.hoisted(() => vi.fn());

vi.mock("fastembed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastembed")>();
  return {
    ...actual,
    SparseEmbeddingModel: {
      ...actual.SparseEmbeddingModel,
      SpladePPEnV1: "prithivida/Splade_PP_en_v1",
    },
    SparseTextEmbedding: {
      init: initMock,
    },
  };
});

describe("FastEmbedSparseEmbeddingModel", () => {
  it("embeds passages and queries with a provided sparse runtime", async () => {
    const runtime: FastEmbedSparseRuntime = {
      passageEmbed: vi.fn(async function* () {
        yield [
          { indices: [1, 2], values: [0.5, 0.25] },
          { indices: [3], values: [1] },
        ];
      }),
      queryEmbed: vi.fn(async () => ({ indices: [9], values: [0.9] })),
    };
    const model = new FastEmbedSparseEmbeddingModel(runtime, {
      model: "prithivida/Splade_PP_en_v1",
      maxBatchSize: 4,
    });

    await expect(model.embedTexts(["alpha", "beta"])).resolves.toEqual([
      { document: "alpha", vector: { indices: [1, 2], values: [0.5, 0.25] } },
      { document: "beta", vector: { indices: [3], values: [1] } },
    ]);
    await expect(model.embedQuery("search")).resolves.toEqual({
      document: "search",
      vector: { indices: [9], values: [0.9] },
    });
    expect(runtime.passageEmbed).toHaveBeenCalledWith(["alpha", "beta"], 4);
    expect(runtime.queryEmbed).toHaveBeenCalledWith("search");
    expect(model.model).toBe(DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL);
  });

  it("creates a default SPLADE++ sparse model", async () => {
    const runtime: FastEmbedSparseRuntime = {
      passageEmbed: vi.fn(async function* () {
        yield [{ indices: [1], values: [1] }];
      }),
      queryEmbed: vi.fn(async () => ({ indices: [1], values: [1] })),
    };
    initMock.mockResolvedValueOnce(runtime);

    const model = await createFastEmbedSparseEmbeddingModel();
    expect(model.model).toBe("prithivida/Splade_PP_en_v1");
    expect(initMock).toHaveBeenCalled();
  });
});
