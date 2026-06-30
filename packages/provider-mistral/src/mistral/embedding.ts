import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import type { Mistral } from "@mistralai/mistralai";
import type { MistralEmbeddingModelName } from "./models";

export type MistralEmbeddingModelOptions = {
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
};

export class MistralEmbeddingModel implements EmbeddingModel {
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;

  constructor(
    private readonly client: Mistral,
    private readonly model: MistralEmbeddingModelName,
    options: MistralEmbeddingModelOptions = {},
  ) {
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 1024;
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
      inputs: texts,
    };
    if (this.dimensions !== undefined) {
      params.dimensions = this.dimensions;
    }

    const response = await this.client.embeddings.create(params as never);
    const data = dataFromResponse(response, texts.length);
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

type EmbeddingData = {
  embedding: number[];
  index: number;
};

function dataFromResponse(response: unknown, inputLength: number): EmbeddingData[] {
  const raw = response as Record<string, unknown>;
  const items = Array.isArray(raw.data) ? raw.data : [];
  const byIndex = new Map<number, EmbeddingData>();

  for (const [position, item] of items.entries()) {
    if (!isObject(item)) {
      throw new Error(`Invalid Mistral embedding response row at position ${position}.`);
    }

    const index = item.index;
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new Error(`Invalid Mistral embedding response index at position ${position}.`);
    }
    if (index < 0 || index >= inputLength) {
      throw new Error(`Mistral embedding response index ${index} was outside the input range.`);
    }
    if (byIndex.has(index)) {
      throw new Error(`Duplicate Mistral embedding response index ${index}.`);
    }
    if (!isNumberArray(item.embedding)) {
      throw new Error(`Invalid Mistral embedding response vector at position ${position}.`);
    }

    byIndex.set(index, { embedding: item.embedding, index });
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
