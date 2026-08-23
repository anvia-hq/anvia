import type { EmbeddingModel, SparseEmbeddingModel, SparseVector } from "@anvia/core/embeddings";
import type {
  ExecutionProvider,
  EmbeddingModel as FastEmbedModel,
  SparseEmbeddingModel as FastEmbedSparseModel,
} from "fastembed";

export type FastEmbedEmbeddingModelId = `${Exclude<FastEmbedModel, FastEmbedModel.CUSTOM>}`;
export type FastEmbedSparseEmbeddingModelId =
  `${Exclude<FastEmbedSparseModel, FastEmbedSparseModel.CUSTOM>}`;

export type FastEmbedRuntime = {
  embed(texts: string[], batchSize?: number): AsyncIterable<unknown>;
};

export type FastEmbedSparseRuntime = {
  passageEmbed(texts: string[], batchSize?: number): AsyncIterable<unknown>;
  queryEmbed(query: string): Promise<unknown>;
};

type FastEmbedLoadOptions = {
  executionProviders?: ExecutionProvider[] | undefined;
  maxLength?: number | undefined;
  cacheDir?: string | undefined;
  showDownloadProgress?: boolean | undefined;
  maxBatchSize?: number | undefined;
};

export type LoadFastEmbedEmbeddingModelOptions = FastEmbedLoadOptions & {
  modelId: FastEmbedEmbeddingModelId;
};

export type LoadFastEmbedSparseEmbeddingModelOptions = FastEmbedLoadOptions & {
  modelId: FastEmbedSparseEmbeddingModelId;
};

export type AdaptFastEmbedEmbeddingModelOptions = {
  runtime: FastEmbedRuntime;
  modelId: string;
  maxBatchSize?: number | undefined;
};

export type AdaptFastEmbedSparseEmbeddingModelOptions = {
  runtime: FastEmbedSparseRuntime;
  modelId: string;
  maxBatchSize?: number | undefined;
};

export type FastEmbedEmbeddingModelHandle = EmbeddingModel;
export type FastEmbedSparseEmbeddingModelHandle = SparseEmbeddingModel;

export type { ExecutionProvider, SparseVector };
