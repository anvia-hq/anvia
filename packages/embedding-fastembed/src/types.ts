import type { ExecutionProvider, EmbeddingModel as FastEmbedModel } from "fastembed";

export type FastEmbedEmbeddingModelName = `${Exclude<FastEmbedModel, FastEmbedModel.CUSTOM>}`;

export type FastEmbedRuntime = {
  embed(texts: string[], batchSize?: number): AsyncIterable<unknown>;
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
