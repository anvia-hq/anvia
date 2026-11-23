import type { Embedding, EmbeddingModel, ModelCallOptions } from "@anvia/core/embeddings";
import { embedTextBatches, isNumberArray, isPlainObject } from "@anvia/core/internal/provider";
import type { GoogleGenAI } from "@google/genai";
import type { GeminiEmbeddingModelId } from "./models";
import { disableGeminiNativeRetries } from "./retry";

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
  modelId: GeminiEmbeddingModelId;
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
  taskType?: GeminiEmbeddingTaskType | undefined;
  title?: string | undefined;
};

export class GeminiEmbeddingModel implements EmbeddingModel {
  readonly provider = "gemini";
  readonly modelId: GeminiEmbeddingModelId;
  readonly dimensions: number | undefined;
  readonly maxBatchSize: number;
  private readonly taskType: GeminiEmbeddingTaskType | undefined;
  private readonly title: string | undefined;

  constructor(
    private readonly client: GoogleGenAI,
    options: GeminiEmbeddingModelOptions,
  ) {
    this.modelId = options.modelId;
    this.dimensions = options.dimensions;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.taskType = options.taskType;
    this.title = options.title;
  }

  async embedTexts(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    return embedTextBatches(texts, this.maxBatchSize, (batch) => this.embedBatch(batch, options));
  }

  private async embedBatch(texts: string[], options?: ModelCallOptions): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const config = { ...this.embeddingConfig() };

    if (options?.abortSignal !== undefined) {
      Object.assign(config, { abortSignal: options.abortSignal });
    }

    const response = await this.client.models.embedContent({
      model: this.modelId,
      contents: texts,
      config: disableGeminiNativeRetries(config),
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
  const raw = isPlainObject(response) ? response : {};

  if (Array.isArray(raw.embeddings)) {
    return raw.embeddings.map((embedding, index) => vectorFromEmbedding(embedding, index));
  }

  if (raw.embedding !== undefined) {
    return [vectorFromEmbedding(raw.embedding, 0)];
  }

  return [];
}

function vectorFromEmbedding(embedding: unknown, position: number): number[] {
  if (!isPlainObject(embedding) || !isNumberArray(embedding.values)) {
    throw new Error(`Invalid Gemini embedding response vector at position ${position}.`);
  }

  return embedding.values;
}
