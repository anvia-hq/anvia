import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import type { Mistral } from "@mistralai/mistralai";

export type MistralEmbeddingModelOptions = {
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
};

export class MistralEmbeddingModel implements EmbeddingModel {
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;

  constructor(
    private readonly client: Mistral,
    private readonly model: string,
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
    const data = dataFromResponse(response);
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

type EmbeddingData = {
  embedding: number[];
  index: number;
};

function dataFromResponse(response: unknown): EmbeddingData[] {
  const raw = response as Record<string, unknown>;
  return Array.isArray(raw.data)
    ? raw.data.flatMap((item): EmbeddingData[] => {
        const data = item as Record<string, unknown>;
        if (!Array.isArray(data.embedding)) {
          return [];
        }
        return [
          {
            embedding: data.embedding.filter((value): value is number => typeof value === "number"),
            index: typeof data.index === "number" ? data.index : 0,
          },
        ];
      })
    : [];
}
