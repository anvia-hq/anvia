import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import type { GoogleGenAI } from "@google/genai";

export type GeminiEmbeddingTaskType =
  | "TASK_TYPE_UNSPECIFIED"
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY";

export type GeminiEmbeddingModelOptions = {
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
  taskType?: GeminiEmbeddingTaskType | undefined;
  title?: string | undefined;
};

export class GeminiEmbeddingModel implements EmbeddingModel {
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;
  private readonly taskType: GeminiEmbeddingTaskType | undefined;
  private readonly title: string | undefined;

  constructor(
    private readonly client: GoogleGenAI,
    private readonly model: string,
    options: GeminiEmbeddingModelOptions = {},
  ) {
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.taskType = options.taskType;
    this.title = options.title;
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

    const response = await this.client.models.embedContent({
      model: this.model,
      contents: texts,
      config: this.embeddingConfig(),
    } as never);
    const rawEmbeddings = embeddingsFromResponse(response);
    if (rawEmbeddings.length !== texts.length) {
      throw new Error(
        `Embedding response length ${rawEmbeddings.length} did not match input length ${texts.length}`,
      );
    }

    return rawEmbeddings.map((vector, index) => ({
      document: texts[index] as string,
      vector,
    }));
  }

  private embeddingConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (this.dimensions !== undefined) config.outputDimensionality = this.dimensions;
    if (this.taskType !== undefined) config.taskType = this.taskType;
    if (this.title !== undefined) config.title = this.title;
    return config;
  }
}

function embeddingsFromResponse(response: unknown): number[][] {
  const raw = response as Record<string, unknown>;
  if (Array.isArray(raw.embeddings)) {
    return raw.embeddings.map((embedding, index) => vectorFromEmbedding(embedding, index));
  }
  if (raw.embedding !== undefined) {
    return [vectorFromEmbedding(raw.embedding, 0)];
  }
  return [];
}

function vectorFromEmbedding(embedding: unknown, position: number): number[] {
  if (!isObject(embedding) || !isNumberArray(embedding.values)) {
    throw new Error(`Invalid Gemini embedding response vector at position ${position}.`);
  }
  return embedding.values;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}
