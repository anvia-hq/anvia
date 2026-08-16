import type { EmbeddingModel } from "@anvia/core/embeddings";

export type TransformersPooling = "mean" | "cls";

export type TransformersTensor = {
  tolist(): unknown;
  dispose(): void;
};

export type TransformersFeatureExtractionPipeline = {
  (
    texts: string[],
    options: { pooling: TransformersPooling; normalize: boolean },
  ): Promise<TransformersTensor>;
  dispose(): Promise<void>;
};

export type TransformersEmbeddingRuntimeOptions = {
  modelId: string;
  pooling?: TransformersPooling | undefined;
  normalize?: boolean | undefined;
  maxBatchSize?: number | undefined;
};

export type LoadTransformersEmbeddingModelOptions = TransformersEmbeddingRuntimeOptions & {
  device?: string | Record<string, string> | undefined;
  dtype?: string | Record<string, string> | undefined;
  cacheDir?: string | undefined;
  localFilesOnly?: boolean | undefined;
  revision?: string | undefined;
};

export type AdaptTransformersEmbeddingModelOptions = TransformersEmbeddingRuntimeOptions & {
  runtime: TransformersFeatureExtractionPipeline;
};

export interface LoadedTransformersEmbeddingModel extends EmbeddingModel, AsyncDisposable {
  close(): Promise<void>;
}

export type TransformersEmbeddingModelHandle = EmbeddingModel;
