import type {
  ModelCallOptions,
  SparseEmbedding,
  SparseEmbeddingModel,
  SparseVector,
} from "@anvia/core/embeddings";
import { SparseEmbeddingModel as FastEmbedSparseModel, SparseTextEmbedding } from "fastembed";
import { parseSparseBatch, parseSparseVector } from "./helpers.js";
import type {
  AdaptFastEmbedSparseEmbeddingModelOptions,
  FastEmbedSparseEmbeddingModelHandle,
  FastEmbedSparseEmbeddingModelId,
  FastEmbedSparseRuntime,
  LoadFastEmbedSparseEmbeddingModelOptions,
} from "./types.js";

export const DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL: FastEmbedSparseEmbeddingModelId =
  FastEmbedSparseModel.SpladePPEnV1;

class FastEmbedSparseEmbeddingModel implements SparseEmbeddingModel {
  readonly provider = "fastembed";
  readonly modelId: string;
  readonly maxBatchSize: number;

  constructor(
    private readonly runtime: FastEmbedSparseRuntime,
    options: { modelId: string; maxBatchSize?: number | undefined },
  ) {
    this.modelId = requireModelId(options.modelId);
    this.maxBatchSize = positiveSafeInteger(options.maxBatchSize ?? 256, "maxBatchSize");
  }

  async embedTexts(texts: string[], options?: ModelCallOptions): Promise<SparseEmbedding[]> {
    throwIfAborted(options?.abortSignal);
    if (texts.length === 0) {
      return [];
    }

    const vectors: SparseVector[] = [];
    for await (const batch of this.runtime.passageEmbed(texts, this.maxBatchSize)) {
      throwIfAborted(options?.abortSignal);
      vectors.push(...parseSparseBatch(batch, vectors.length));
    }

    if (vectors.length !== texts.length) {
      throw new Error(
        `FastEmbed sparse embedding model returned ${vectors.length} embeddings for ${texts.length} texts`,
      );
    }

    return texts.map((document, index) => ({
      document,
      vector: vectors[index] as SparseVector,
    }));
  }

  async embedQuery(query: string, options?: ModelCallOptions): Promise<SparseEmbedding> {
    throwIfAborted(options?.abortSignal);
    const vector = parseSparseVector(await this.runtime.queryEmbed(query), 0);
    throwIfAborted(options?.abortSignal);
    return { document: query, vector };
  }
}

export async function loadFastEmbedSparseEmbeddingModel(
  options: LoadFastEmbedSparseEmbeddingModelOptions,
): Promise<FastEmbedSparseEmbeddingModelHandle> {
  validateLoadOptions(options);
  const initOptions: Record<string, unknown> = {
    model: options.modelId as Exclude<FastEmbedSparseModel, FastEmbedSparseModel.CUSTOM>,
  };
  if (options.executionProviders !== undefined) {
    initOptions.executionProviders = options.executionProviders;
  }
  if (options.maxLength !== undefined) initOptions.maxLength = options.maxLength;
  if (options.cacheDir !== undefined) initOptions.cacheDir = options.cacheDir;
  if (options.showDownloadProgress !== undefined) {
    initOptions.showDownloadProgress = options.showDownloadProgress;
  }
  const runtime = await SparseTextEmbedding.init(initOptions as never);
  return new FastEmbedSparseEmbeddingModel(runtime, options);
}

export function adaptFastEmbedSparseEmbeddingModel(
  options: AdaptFastEmbedSparseEmbeddingModelOptions,
): FastEmbedSparseEmbeddingModelHandle {
  return new FastEmbedSparseEmbeddingModel(options.runtime, options);
}

function validateLoadOptions(options: LoadFastEmbedSparseEmbeddingModelOptions): void {
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
