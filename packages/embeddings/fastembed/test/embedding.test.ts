import { embedTexts } from "@anvia/core";
import { describe, expect, it, vi } from "vitest";
import {
  createFastEmbedEmbeddingModel,
  DEFAULT_FASTEMBED_EMBEDDING_MODEL,
  FastEmbedEmbeddingModel,
  type FastEmbedRuntime,
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
    const model = new FastEmbedEmbeddingModel(runtime, {
      model: "fast-bge-small-en-v1.5",
      maxBatchSize: 8,
    });

    const embeddings = await model.embedTexts(["alpha", "beta"]);

    expect(runtime.embed).toHaveBeenCalledWith(["alpha", "beta"], 8);
    expect(model.model).toBe("fast-bge-small-en-v1.5");
    expect(model.maxBatchSize).toBe(8);
    expect(embeddings).toEqual([
      { document: "alpha", vector: [0.1, 0.2] },
      { document: "beta", vector: [0.3, 0.4] },
    ]);
  });

  it("creates a default BGE Small embedding model", async () => {
    const runtime: FastEmbedRuntime = {
      embed: vi.fn(async function* () {
        yield [[1, 0]];
      }),
    };
    initMock.mockResolvedValueOnce(runtime);

    const model = await createFastEmbedEmbeddingModel();
    const embeddings = await embedTexts(model, ["market note"]);

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
    const model = new FastEmbedEmbeddingModel(runtime);

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

    await createFastEmbedEmbeddingModel({
      model: "fast-bge-base-en-v1.5",
      initOptions: { cacheDir: "/tmp/anvia-fastembed" },
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
    const model = new FastEmbedEmbeddingModel(runtime);

    await expect(model.embedTexts(["one", "two"])).rejects.toThrow(
      "returned 1 embeddings for 2 texts",
    );
  });
});
