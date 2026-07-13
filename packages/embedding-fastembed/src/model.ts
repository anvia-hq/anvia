import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import { EmbeddingModel as FastEmbedModel, FlagEmbedding } from "fastembed";
import { parseBatch } from "./helpers.js";
import type {
  FastEmbedEmbeddingModelName,
  FastEmbedEmbeddingModelOptions,
  FastEmbedRuntime,
} from "./types.js";

export const DEFAULT_FASTEMBED_EMBEDDING_MODEL: FastEmbedEmbeddingModelName =
  FastEmbedModel.BGESmallENV15;

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
    const initOptions = Object.assign({}, options.initOptions, { model });
    const runtime = await FlagEmbedding.init(initOptions as never);

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
