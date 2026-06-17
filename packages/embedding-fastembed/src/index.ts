import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import type { ExecutionProvider } from "fastembed";
import { EmbeddingModel as FastEmbedModel, FlagEmbedding } from "fastembed";

export const DEFAULT_FASTEMBED_EMBEDDING_MODEL = FastEmbedModel.BGESmallENV15;

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

export class FastEmbedEmbeddingModel implements EmbeddingModel {
  readonly model: string;
  readonly maxBatchSize: number;

  constructor(
    private readonly runtime: FastEmbedRuntime,
    options: FastEmbedEmbeddingModelOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_FASTEMBED_EMBEDDING_MODEL;
    this.maxBatchSize = Math.max(1, Math.trunc(options.maxBatchSize ?? 256));
  }

  static async create(
    options: FastEmbedEmbeddingModelOptions = {},
  ): Promise<FastEmbedEmbeddingModel> {
    const model = options.model ?? DEFAULT_FASTEMBED_EMBEDDING_MODEL;
    const runtime = await FlagEmbedding.init({
      ...(options.initOptions ?? {}),
      model,
    } as never);

    return new FastEmbedEmbeddingModel(runtime, { ...options, model });
  }

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const vectors: number[][] = [];
    for await (const batch of this.runtime.embed(texts, this.maxBatchSize)) {
      vectors.push(...parseBatch(batch, vectors.length));
    }

    if (vectors.length !== texts.length) {
      throw new Error(
        `FastEmbed embedding model returned ${vectors.length} embeddings for ${texts.length} texts`,
      );
    }

    return texts.map((document, index) => ({
      document,
      vector: vectors[index] as number[],
    }));
  }
}

export function createFastEmbedEmbeddingModel(
  options: FastEmbedEmbeddingModelOptions = {},
): Promise<FastEmbedEmbeddingModel> {
  return FastEmbedEmbeddingModel.create(options);
}

function parseBatch(batch: unknown, offset: number): number[][] {
  if (!Array.isArray(batch)) {
    throw new Error(`FastEmbed embedding model returned an invalid batch at offset ${offset}`);
  }

  return batch.map((vector, index) => {
    const values = vectorToArray(vector);
    if (values === undefined) {
      throw new Error(
        `FastEmbed embedding model returned an invalid vector at index ${offset + index}`,
      );
    }
    return values;
  });
}

function vectorToArray(vector: unknown): number[] | undefined {
  if (Array.isArray(vector) && vector.every((item) => typeof item === "number")) {
    return vector;
  }

  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) {
    return Array.from(vector as unknown as ArrayLike<number>);
  }

  return undefined;
}
