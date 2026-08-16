import { embedTexts } from "@anvia/core/embeddings";
import { describe, expect, it, vi } from "vitest";
import {
  adaptFastEmbedEmbeddingModel,
  DEFAULT_FASTEMBED_EMBEDDING_MODEL,
  type FastEmbedRuntime,
  loadFastEmbedEmbeddingModel,
} from "../src/index";

const initMock = vi.hoisted(() => vi.fn());

vi.mock("fastembed", () => ({
  EmbeddingModel: {
    BGESmallENV15: "fast-bge-small-en-v1.5",
    BGEBaseENV15: "fast-bge-base-en-v1.5",
  },
  FlagEmbedding: {
    init: initMock,
  },
  SparseEmbeddingModel: {
    SpladePPEnV1: "prithivida/Splade_PP_en_v1",
  },
  SparseTextEmbedding: {
    init: vi.fn(),
  },
}));

describe("FastEmbedEmbeddingModel", () => {
  it("embeds text with a provided FastEmbed runtime", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [
          [0.1, 0.2],
          [0.3, 0.4],
        ];
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
      maxBatchSize: 8,
    });

    const embeddings = await model.embedTexts(["alpha", "beta"]);

    expect(runtime.embed).toHaveBeenCalledWith(["alpha", "beta"], 8);
    expect(model.modelId).toBe("fast-bge-small-en-v1.5");
    expect(model.maxBatchSize).toBe(8);
    expect(embeddings).toEqual([
      { document: "alpha", vector: [0.1, 0.2] },
      { document: "beta", vector: [0.3, 0.4] },
    ]);
  });

  it("returns no embeddings for empty input without calling the runtime", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
    });

    await expect(model.embedTexts([])).resolves.toEqual([]);
    expect(runtime.embed).not.toHaveBeenCalled();
  });

  it("rejects invalid and fractional max batch sizes", () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [];
      }),
    };

    expect(() =>
      adaptFastEmbedEmbeddingModel({
        runtime,
        modelId: "fast-bge-small-en-v1.5",
        maxBatchSize: 0,
      }),
    ).toThrow("maxBatchSize must be a positive safe integer");
    expect(() =>
      adaptFastEmbedEmbeddingModel({
        runtime,
        modelId: "fast-bge-small-en-v1.5",
        maxBatchSize: 2.9,
      }),
    ).toThrow("maxBatchSize must be a positive safe integer");
  });

  it("creates a default BGE Small embedding model", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
      }),
    };
    initMock.mockResolvedValueOnce(runtime);

    const model = await loadFastEmbedEmbeddingModel({
      modelId: DEFAULT_FASTEMBED_EMBEDDING_MODEL,
    });
    const { embeddings } = await embedTexts({ model, texts: ["market note"] });

    expect(initMock).toHaveBeenCalledWith({
      model: DEFAULT_FASTEMBED_EMBEDDING_MODEL,
    });
    expect(embeddings).toEqual([{ document: "market note", vector: [1, 0] }]);
  });

  it("accepts typed-array vectors returned by FastEmbed", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [new Float32Array([0.25, 0.75])];
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
    });

    await expect(model.embedTexts(["typed"])).resolves.toEqual([
      { document: "typed", vector: [0.25, 0.75] },
    ]);
  });

  it("passes init options through to FastEmbed", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
      }),
    };
    initMock.mockResolvedValueOnce(runtime);

    await loadFastEmbedEmbeddingModel({
      modelId: "fast-bge-base-en-v1.5",
      cacheDir: "/tmp/anvia-fastembed",
    });

    expect(initMock).toHaveBeenCalledWith({
      cacheDir: "/tmp/anvia-fastembed",
      model: "fast-bge-base-en-v1.5",
    });
  });

  it("rejects malformed embedding output", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
    });

    await expect(model.embedTexts(["one", "two"])).rejects.toThrow(
      "returned 1 embeddings for 2 texts",
    );
  });

  it("rejects non-array batches from FastEmbed", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield "not-a-batch";
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
    });

    await expect(model.embedTexts(["one"])).rejects.toThrow("invalid batch at offset 0");
  });

  it("rejects invalid vectors with the correct absolute index", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
        yield [new DataView(new ArrayBuffer(8))];
      }),
    };
    const model = adaptFastEmbedEmbeddingModel({
      runtime,
      modelId: "fast-bge-small-en-v1.5",
    });

    await expect(model.embedTexts(["one", "two"])).rejects.toThrow("invalid vector at index 1");
  });
});
