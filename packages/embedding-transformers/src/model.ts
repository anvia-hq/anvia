import type { Embedding, EmbeddingModel, ModelCallOptions } from "@anvia/core/embeddings";
import { pipeline as transformersPipeline } from "@huggingface/transformers";
import { parseVectors } from "./helpers.js";
import type {
  AdaptTransformersEmbeddingModelOptions,
  LoadedTransformersEmbeddingModel,
  LoadTransformersEmbeddingModelOptions,
  TransformersEmbeddingModelHandle,
  TransformersFeatureExtractionPipeline,
  TransformersPooling,
  TransformersTensor,
} from "./types.js";

export const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

class TransformersEmbeddingModel implements EmbeddingModel {
  readonly provider = "transformers";
  readonly modelId: string;
  readonly maxBatchSize: number;

  private readonly pooling: TransformersPooling;
  private readonly normalize: boolean;

  constructor(
    protected readonly runtime: TransformersFeatureExtractionPipeline,
    options: {
      modelId: string;
      pooling?: TransformersPooling | undefined;
      normalize?: boolean | undefined;
      maxBatchSize?: number | undefined;
    },
  ) {
    this.modelId = requireModelId(options.modelId);
    this.pooling = options.pooling ?? "mean";
    this.normalize = options.normalize ?? true;
    this.maxBatchSize = positiveSafeInteger(options.maxBatchSize ?? 16, "maxBatchSize");
  }

  protected beginCall(): void {}
  protected endCall(): void {}

  async embedTexts(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    this.beginCall();
    let output: TransformersTensor | undefined;
    try {
      throwIfAborted(options?.abortSignal);
      if (texts.length === 0) {
        return [];
      }

      output = await this.runtime(texts, {
        pooling: this.pooling,
        normalize: this.normalize,
      });
      throwIfAborted(options?.abortSignal);
      const vectors = parseVectors(output.tolist(), texts.length);

      return texts.map((document, index) => ({
        document,
        vector: vectors[index] as number[],
      }));
    } finally {
      try {
        output?.dispose();
      } finally {
        this.endCall();
      }
    }
  }
}

class OwnedTransformersEmbeddingModel
  extends TransformersEmbeddingModel
  implements LoadedTransformersEmbeddingModel
{
  private closed = false;
  private activeCalls = 0;
  private readonly idleWaiters = new Set<() => void>();
  private closePromise: Promise<void> | undefined;

  protected override beginCall(): void {
    if (this.closed) {
      throw new Error("Transformers embedding model is closed.");
    }
    this.activeCalls += 1;
  }

  protected override endCall(): void {
    this.activeCalls -= 1;
    if (this.activeCalls === 0) {
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = (async () => {
      if (this.activeCalls > 0) {
        await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
      }
      await this.runtime.dispose();
    })();
    return this.closePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export async function loadTransformersEmbeddingModel(
  options: LoadTransformersEmbeddingModelOptions,
): Promise<LoadedTransformersEmbeddingModel> {
  const normalized = normalizeRuntimeOptions(options);
  let runtime: TransformersFeatureExtractionPipeline | undefined;
  try {
    const runtimeOptions: Record<string, unknown> = {};
    if (options.device !== undefined) runtimeOptions.device = options.device;
    if (options.dtype !== undefined) runtimeOptions.dtype = options.dtype;
    if (options.cacheDir !== undefined) runtimeOptions.cache_dir = options.cacheDir;
    if (options.localFilesOnly !== undefined) {
      runtimeOptions.local_files_only = options.localFilesOnly;
    }
    if (options.revision !== undefined) runtimeOptions.revision = options.revision;
    runtime = (await transformersPipeline(
      "feature-extraction",
      normalized.modelId,
      runtimeOptions as never,
    )) as TransformersFeatureExtractionPipeline;
    return new OwnedTransformersEmbeddingModel(runtime, normalized);
  } catch (error) {
    await runtime?.dispose();
    throw error;
  }
}

export function adaptTransformersEmbeddingModel(
  options: AdaptTransformersEmbeddingModelOptions,
): TransformersEmbeddingModelHandle {
  return new TransformersEmbeddingModel(options.runtime, normalizeRuntimeOptions(options));
}

function normalizeRuntimeOptions(options: {
  modelId: string;
  pooling?: TransformersPooling | undefined;
  normalize?: boolean | undefined;
  maxBatchSize?: number | undefined;
}) {
  return {
    modelId: requireModelId(options.modelId),
    pooling: options.pooling,
    normalize: options.normalize,
    maxBatchSize: positiveSafeInteger(options.maxBatchSize ?? 16, "maxBatchSize"),
  };
}

function requireModelId(modelId: string): string {
  if (modelId.trim().length === 0) {
    throw new TypeError("modelId must be a non-empty string");
  }
  return modelId;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
