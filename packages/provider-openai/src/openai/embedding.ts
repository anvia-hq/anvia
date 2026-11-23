import type { Embedding, EmbeddingModel, ModelCallOptions } from "@anvia/core/embeddings";
import { embedTextBatches, indexedEmbeddingDataFromResponse } from "@anvia/core/internal/provider";
import type OpenAI from "openai";
import type { OpenAIEmbeddingModelId } from "./models";

export type OpenAIEmbeddingModelOptions = {
  modelId: OpenAIEmbeddingModelId;
  dimensions?: number | undefined;
  user?: string | undefined;
  maxBatchSize?: number | undefined;
};

export class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly provider = "openai";
  readonly modelId: OpenAIEmbeddingModelId;
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;
  private readonly user: string | undefined;

  constructor(
    private readonly client: OpenAI,
    options: OpenAIEmbeddingModelOptions,
  ) {
    this.modelId = options.modelId;
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 1024;
    this.user = options.user;
  }

  async embedTexts(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    return embedTextBatches(texts, this.maxBatchSize, (batch) => this.embedBatch(batch, options));
  }

  private async embedBatch(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const params: Record<string, unknown> = {
      model: this.modelId,
      input: texts,
    };

    if (this.dimensions !== undefined) {
      params.dimensions = this.dimensions;
    }

    if (this.user !== undefined) {
      params.user = this.user;
    }

    const response = await this.client.embeddings.create(params as never, {
      signal: options?.abortSignal,
      maxRetries: 0,
    });
    const data = indexedEmbeddingDataFromResponse(response, texts.length);

    if (data.length !== texts.length) {
      throw new Error(
        `Embedding response length ${data.length} did not match input length ${texts.length}`,
      );
    }

    return texts.map((document, index) => {
      const item = data[index];

      if (item === undefined) {
        throw new Error(`Embedding response did not contain index ${index}`);
      }

      return {
        document,
        vector: item.embedding,
      };
    });
  }
}
