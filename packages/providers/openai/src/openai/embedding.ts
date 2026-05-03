import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import type OpenAI from "openai";

export type ProviderEmbeddingModelOptions = {
  dimensions?: number | undefined;
  user?: string | undefined;
  maxBatchSize?: number | undefined;
};

export class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;
  private readonly user: string | undefined;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    options: ProviderEmbeddingModelOptions = {},
  ) {
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 1024;
    this.user = options.user;
  }

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    const embeddings: Embedding[] = [];
    for (let index = 0; index < texts.length; index += this.maxBatchSize) {
      const batch = texts.slice(index, index + this.maxBatchSize);
      embeddings.push(...(await this.embedBatch(batch)));
    }
    return embeddings;
  }

  private async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const params: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.dimensions !== undefined) {
      params.dimensions = this.dimensions;
    }
    if (this.user !== undefined) {
      params.user = this.user;
    }

    const response = await this.client.embeddings.create(params as never);
    const data = Array.isArray(response.data) ? response.data : [];
    if (data.length !== texts.length) {
      throw new Error(
        `Embedding response length ${data.length} did not match input length ${texts.length}`,
      );
    }

    return data
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item, index) => ({
        document: texts[index] as string,
        vector: item.embedding,
      }));
  }
}
