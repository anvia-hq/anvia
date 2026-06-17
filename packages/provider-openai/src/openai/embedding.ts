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
    const data = embeddingDataFromResponse(response, texts.length);
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

type EmbeddingData = {
  index: number;
  embedding: number[];
};

function embeddingDataFromResponse(response: unknown, inputLength: number): EmbeddingData[] {
  const raw = response as Record<string, unknown>;
  const data = Array.isArray(raw.data) ? raw.data : [];
  const byIndex = new Map<number, EmbeddingData>();

  for (const [position, item] of data.entries()) {
    if (!isObject(item) || typeof item.index !== "number" || !Number.isInteger(item.index)) {
      throw new Error(`Embedding response item ${position} contained an invalid index`);
    }

    const index = item.index;
    if (index < 0 || index >= inputLength) {
      throw new Error(
        `Embedding response index ${index} was outside input range 0..${inputLength - 1}`,
      );
    }

    if (byIndex.has(index)) {
      throw new Error(`Embedding response contained duplicate index ${index}`);
    }

    if (!isNumberArray(item.embedding)) {
      throw new Error(`Embedding response item ${position} contained an invalid embedding`);
    }

    byIndex.set(index, { index, embedding: item.embedding });
  }

  return Array.from({ length: inputLength }, (_, index) => byIndex.get(index)).filter(
    (item): item is EmbeddingData => item !== undefined,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}
