import { describe, expect, it, vi } from "vitest";
import {
  adaptFastEmbedSparseEmbeddingModel,
  DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL,
  type FastEmbedSparseRuntime,
  loadFastEmbedSparseEmbeddingModel,
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
    const model = adaptFastEmbedSparseEmbeddingModel({
      runtime,
      modelId: "prithivida/Splade_PP_en_v1",
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
    expect(model.modelId).toBe(DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL);
  });

  it("creates a default SPLADE++ sparse model", async () => {
    const runtime: FastEmbedSparseRuntime = {
      passageEmbed: vi.fn(async function* () {
        yield [{ indices: [1], values: [1] }];
      }),
      queryEmbed: vi.fn(async () => ({ indices: [1], values: [1] })),
    };
    initMock.mockResolvedValueOnce(runtime);

    const model = await loadFastEmbedSparseEmbeddingModel({
      modelId: DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL,
    });
    expect(model.modelId).toBe("prithivida/Splade_PP_en_v1");
    expect(initMock).toHaveBeenCalled();
  });

  it("rejects bigint typed-array sparse vectors", async () => {
    const runtime: FastEmbedSparseRuntime = {
      passageEmbed: vi.fn(async function* () {
        yield [{ indices: new BigInt64Array([1n]), values: new Float32Array([1]) }];
      }),
      queryEmbed: vi.fn(async () => ({
        indices: new BigUint64Array([1n]),
        values: new Float32Array([1]),
      })),
    };
    const model = adaptFastEmbedSparseEmbeddingModel({
      runtime,
      modelId: "prithivida/Splade_PP_en_v1",
    });

    await expect(model.embedTexts(["alpha"])).rejects.toThrow("invalid vector");
    await expect(model.embedQuery("search")).rejects.toThrow("invalid vector");
  });
});
