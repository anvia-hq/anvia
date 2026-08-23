import { embedTexts } from "@anvia/core/embeddings";
import { describe, expect, it, vi } from "vitest";
import {
  adaptTransformersEmbeddingModel,
  DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
  loadTransformersEmbeddingModel,
  type TransformersFeatureExtractionPipeline,
  type TransformersTensor,
} from "../src/index";

const pipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

describe("Transformers embedding models", () => {
  it("adapts a caller-owned feature extraction runtime", async () => {
    const runtime = runtimeReturning([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const model = adaptTransformersEmbeddingModel({
      runtime,
      modelId: "custom-model",
      pooling: "mean",
      normalize: true,
      maxBatchSize: 8,
    });

    const embeddings = await model.embedTexts(["alpha", "beta"]);

    expect(runtime).toHaveBeenCalledWith(["alpha", "beta"], {
      pooling: "mean",
      normalize: true,
    });
    expect(model.modelId).toBe("custom-model");
    expect(model.maxBatchSize).toBe(8);
    expect(embeddings).toEqual([
      { document: "alpha", vector: [0.1, 0.2] },
      { document: "beta", vector: [0.3, 0.4] },
    ]);
  });

  it("uses default pooling and normalization options", async () => {
    const runtime = runtimeReturning([[0.1, 0.2]]);
    const model = adaptTransformersEmbeddingModel({ runtime, modelId: "custom-model" });

    await model.embedTexts(["alpha"]);

    expect(runtime).toHaveBeenCalledWith(["alpha"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it("returns no embeddings without calling the runtime", async () => {
    const runtime = runtimeReturning([[0.1, 0.2]]);
    const model = adaptTransformersEmbeddingModel({ runtime, modelId: "custom-model" });

    await expect(model.embedTexts([])).resolves.toEqual([]);
    expect(runtime).not.toHaveBeenCalled();
  });

  it("loads a model eagerly and disposes every output tensor", async () => {
    const output = tensor([[1, 0]]);
    const runtime = runtimeReturning(output);
    pipelineMock.mockResolvedValueOnce(runtime);

    const model = await loadTransformersEmbeddingModel({
      modelId: DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
    });
    const { embeddings } = await embedTexts({ model, texts: ["market note"] });

    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
      {},
    );
    expect(output.dispose).toHaveBeenCalledOnce();
    expect(embeddings).toEqual([{ document: "market note", vector: [1, 0] }]);
    await model.close();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("waits for active inference before terminal, idempotent close", async () => {
    let resolveOutput!: (output: TransformersTensor) => void;
    const runtime = vi.fn(
      () => new Promise<TransformersTensor>((resolve) => (resolveOutput = resolve)),
    ) as unknown as TransformersFeatureExtractionPipeline;
    runtime.dispose = vi.fn(async () => {});
    const model = await loadedModel(runtime);

    const inference = model.embedTexts(["one"]);
    const close = model.close();
    expect(runtime.dispose).not.toHaveBeenCalled();
    resolveOutput(tensor([[1, 0]]));
    await inference;
    await Promise.all([close, model.close()]);

    expect(runtime.dispose).toHaveBeenCalledOnce();
    await expect(model.embedTexts(["two"])).rejects.toThrow("is closed");
  });

  it("releases active-call state when tensor disposal fails", async () => {
    const output = tensor([[1, 0]]);
    output.dispose.mockImplementationOnce(() => {
      throw new Error("tensor disposal failed");
    });
    const runtime = runtimeReturning(output);
    const model = await loadedModel(runtime);

    await expect(model.embedTexts(["one"])).rejects.toThrow("tensor disposal failed");
    await expect(model.close()).resolves.toBeUndefined();

    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("never disposes a caller-owned adapted runtime", async () => {
    const runtime = runtimeReturning([[1, 0]]);
    const model = adaptTransformersEmbeddingModel({ runtime, modelId: "custom-model" });

    await model.embedTexts(["one"]);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("validates batch sizes instead of clamping them", () => {
    const runtime = runtimeReturning([]);
    expect(() =>
      adaptTransformersEmbeddingModel({ runtime, modelId: "custom-model", maxBatchSize: 0 }),
    ).toThrow("maxBatchSize must be a positive safe integer");
  });

  it("rejects malformed embedding output and still disposes the tensor", async () => {
    const output = tensor([[1, 0]]);
    const runtime = runtimeReturning(output);
    const model = adaptTransformersEmbeddingModel({ runtime, modelId: "custom-model" });

    await expect(model.embedTexts(["one", "two"])).rejects.toThrow(
      "returned 1 embeddings for 2 texts",
    );
    expect(output.dispose).toHaveBeenCalledOnce();
  });

  it("rejects non-array output and invalid vectors", async () => {
    const malformed = adaptTransformersEmbeddingModel({
      runtime: runtimeReturning("not-vectors"),
      modelId: "custom-model",
    });
    const invalid = adaptTransformersEmbeddingModel({
      runtime: runtimeReturning([["not-a-number"]]),
      modelId: "custom-model",
    });

    await expect(malformed.embedTexts(["one"])).rejects.toThrow(
      "returned 0 embeddings for 1 texts",
    );
    await expect(invalid.embedTexts(["one"])).rejects.toThrow("invalid vector at index 0");
  });
});

function tensor(value: unknown) {
  return { tolist: () => value, dispose: vi.fn() };
}

function runtimeReturning(
  value: unknown | TransformersTensor,
): TransformersFeatureExtractionPipeline {
  const runtime = vi.fn(async () =>
    typeof value === "object" && value !== null && "tolist" in value ? value : tensor(value),
  ) as unknown as TransformersFeatureExtractionPipeline;
  runtime.dispose = vi.fn(async () => {});
  return runtime;
}

async function loadedModel(runtime: TransformersFeatureExtractionPipeline) {
  pipelineMock.mockResolvedValueOnce(runtime);
  return loadTransformersEmbeddingModel({ modelId: "custom-model" });
}
