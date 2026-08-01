import type { SparseVector } from "@anvia/core/embeddings";
import type {
  ExecutionProvider,
  EmbeddingModel as FastEmbedModel,
  SparseEmbeddingModel as FastEmbedSparseModel,
} from "fastembed";

export type FastEmbedEmbeddingModelName = `${Exclude<FastEmbedModel, FastEmbedModel.CUSTOM>}`;

export type FastEmbedSparseEmbeddingModelName =
  `${Exclude<FastEmbedSparseModel, FastEmbedSparseModel.CUSTOM>}`;

export type FastEmbedRuntime = {
  embed(texts: string[], batchSize?: number): AsyncIterable<unknown>;
};

export type FastEmbedSparseRuntime = {
  passageEmbed(texts: string[], batchSize?: number): AsyncIterable<unknown>;
  queryEmbed(query: string): Promise<unknown>;
};

export type FastEmbedEmbeddingModelOptions = {
  model?: FastEmbedEmbeddingModelName | undefined;
  maxBatchSize?: number | undefined;
  initOptions?:
    | {
        executionProviders?: ExecutionProvider[] | undefined;
        maxLength?: number | undefined;
        cacheDir?: string | undefined;
        showDownloadProgress?: boolean | undefined;
        modelName?: string | undefined;
      }
    | undefined;
};

export type FastEmbedSparseEmbeddingModelOptions = {
  model?: FastEmbedSparseEmbeddingModelName | undefined;
  maxBatchSize?: number | undefined;
  initOptions?:
    | {
        executionProviders?: ExecutionProvider[] | undefined;
        maxLength?: number | undefined;
        cacheDir?: string | undefined;
        showDownloadProgress?: boolean | undefined;
        modelName?: string | undefined;
      }
    | undefined;
};

export type { SparseVector };
