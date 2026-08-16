import type { Embedding, EmbeddingModel, ModelCallOptions } from "@anvia/core/embeddings";
import { EmbeddingModel as FastEmbedModel, FlagEmbedding } from "fastembed";
import { parseBatch } from "./helpers.js";
import type {
  AdaptFastEmbedEmbeddingModelOptions,
  FastEmbedEmbeddingModelHandle,
  FastEmbedEmbeddingModelId,
  FastEmbedRuntime,
  LoadFastEmbedEmbeddingModelOptions,
} from "./types.js";

export const DEFAULT_FASTEMBED_EMBEDDING_MODEL: FastEmbedEmbeddingModelId =
  FastEmbedModel.BGESmallENV15;

class FastEmbedEmbeddingModel implements EmbeddingModel {
  readonly provider = "fastembed";
  readonly modelId: string;
  readonly maxBatchSize: number;

  constructor(
    private readonly runtime: FastEmbedRuntime,
    options: { modelId: string; maxBatchSize?: number | undefined },
  ) {
    this.modelId = requireModelId(options.modelId);
    this.maxBatchSize = positiveSafeInteger(options.maxBatchSize ?? 256, "maxBatchSize");
  }

  async embedTexts(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    throwIfAborted(options?.abortSignal);
    if (texts.length === 0) {
      return [];
    }

    const vectors: number[][] = [];
    for await (const batch of this.runtime.embed(texts, this.maxBatchSize)) {
      throwIfAborted(options?.abortSignal);
      vectors.push(...parseBatch(batch, vectors.length));
    }

    if (vectors.length !== texts.length) {
      throw new Error(
        `FastEmbed embedding model returned ${vectors.length} embeddings for ${texts.length} texts`,
      );
    }

    return texts.map((document, index) => ({
      document,
      vector: vectors[index] as number[],
    }));
  }
}

export async function loadFastEmbedEmbeddingModel(
  options: LoadFastEmbedEmbeddingModelOptions,
): Promise<FastEmbedEmbeddingModelHandle> {
  validateLoadOptions(options);
  const runtime = await FlagEmbedding.init({
    model: options.modelId as Exclude<FastEmbedModel, FastEmbedModel.CUSTOM>,
    ...(options.executionProviders === undefined
      ? {}
      : { executionProviders: options.executionProviders }),
    ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }),
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    ...(options.showDownloadProgress === undefined
      ? {}
      : { showDownloadProgress: options.showDownloadProgress }),
  });
  return new FastEmbedEmbeddingModel(runtime, options);
}

export function adaptFastEmbedEmbeddingModel(
  options: AdaptFastEmbedEmbeddingModelOptions,
): FastEmbedEmbeddingModelHandle {
  return new FastEmbedEmbeddingModel(options.runtime, options);
}

function validateLoadOptions(options: LoadFastEmbedEmbeddingModelOptions): void {
  requireModelId(options.modelId);
  if (options.maxLength !== undefined) {
    positiveSafeInteger(options.maxLength, "maxLength");
  }
  if (options.maxBatchSize !== undefined) {
    positiveSafeInteger(options.maxBatchSize, "maxBatchSize");
  }
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
