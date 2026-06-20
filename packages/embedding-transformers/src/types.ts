export type TransformersPooling = "mean" | "cls";

export type TransformersFeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: TransformersPooling; normalize: boolean },
) => Promise<{ tolist(): unknown }>;

export type TransformersEmbeddingModelOptions = {
  model?: string | undefined;
  pooling?: TransformersPooling | undefined;
  normalize?: boolean | undefined;
  maxBatchSize?: number | undefined;
};
