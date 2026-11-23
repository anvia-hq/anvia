import type { Embedding, EmbeddingModel, ModelCallOptions } from "@anvia/core/embeddings";
import { embedTextBatches, indexedEmbeddingDataFromResponse } from "@anvia/core/internal/provider";
import type { Mistral } from "@mistralai/mistralai";
import type { MistralEmbeddingModelId } from "./models";

export type MistralEmbeddingModelOptions = {
  modelId: MistralEmbeddingModelId;
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
};

export class MistralEmbeddingModel implements EmbeddingModel {
  readonly provider = "mistral";
  readonly modelId: MistralEmbeddingModelId;
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;

  constructor(
    private readonly client: Mistral,
    options: MistralEmbeddingModelOptions,
  ) {
    this.modelId = options.modelId;
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 1024;
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
      inputs: texts,
    };

    if (this.dimensions !== undefined) {
      params.outputDimension = this.dimensions;
    }

    const response = await this.client.embeddings.create(
      params as never,
      { signal: options?.abortSignal, retries: { strategy: "none" } } as never,
    );
    const data = indexedEmbeddingDataFromResponse(response, texts.length, "Mistral");

    if (data.length !== texts.length) {
      throw new Error(
        `Embedding response length ${data.length} did not match input length ${texts.length}`,
      );
    }

    return Array.from({ length: texts.length }, (_, index) => ({
      document: texts[index] as string,
      vector: data[index]?.embedding ?? [],
    }));
  }
}
