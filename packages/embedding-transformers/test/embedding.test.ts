import { embedTexts } from "@anvia/core/embeddings";
import { describe, expect, it, vi } from "vitest";
import {
  createTransformersEmbeddingModel,
  DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
  TransformersEmbeddingModel,
  type TransformersFeatureExtractionPipeline,
} from "../src/index";

const pipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

describe("TransformersEmbeddingModel", () => {
  it("embeds text with a provided feature extraction pipeline", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    }));
    const model = new TransformersEmbeddingModel(extractor, {
      model: "custom-model",
      pooling: "mean",
      normalize: true,
      maxBatchSize: 8,
    });

    const embeddings = await model.embedTexts(["alpha", "beta"]);

    expect(extractor).toHaveBeenCalledWith(["alpha", "beta"], {
      pooling: "mean",
      normalize: true,
    });
    expect(model.model).toBe("custom-model");
    expect(model.maxBatchSize).toBe(8);
    expect(embeddings).toEqual([
      { document: "alpha", vector: [0.1, 0.2] },
      { document: "beta", vector: [0.3, 0.4] },
    ]);
  });

  it("uses default pooling and normalization options", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [[0.1, 0.2]],
    }));
    const model = new TransformersEmbeddingModel(extractor);

    await model.embedTexts(["alpha"]);

    expect(extractor).toHaveBeenCalledWith(["alpha"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it("returns no embeddings for empty input without calling the extractor", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [[0.1, 0.2]],
    }));
    const model = new TransformersEmbeddingModel(extractor);

    await expect(model.embedTexts([])).resolves.toEqual([]);
    expect(extractor).not.toHaveBeenCalled();
  });

  it("creates a default All-MiniLM embedding model", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [[1, 0]],
    }));
    pipelineMock.mockResolvedValueOnce(extractor);

    const model = await createTransformersEmbeddingModel();
    const { embeddings } = await embedTexts({ model, texts: ["market note"] });

    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
    );
    expect(embeddings).toEqual([{ document: "market note", vector: [1, 0] }]);
  });

  it("rejects malformed embedding output", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [[1, 0]],
    }));
    const model = new TransformersEmbeddingModel(extractor);

    await expect(model.embedTexts(["one", "two"])).rejects.toThrow(
      "returned 1 embeddings for 2 texts",
    );
  });

  it("rejects non-array embedding output", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => "not-vectors",
    }));
    const model = new TransformersEmbeddingModel(extractor);

    await expect(model.embedTexts(["one"])).rejects.toThrow("returned 0 embeddings for 1 texts");
  });

  it("rejects invalid vectors", async () => {
    const extractor: TransformersFeatureExtractionPipeline = vi.fn(async () => ({
      tolist: () => [["not-a-number"]],
    }));
    const model = new TransformersEmbeddingModel(extractor);

    await expect(model.embedTexts(["one"])).rejects.toThrow("invalid vector at index 0");
  });
});
