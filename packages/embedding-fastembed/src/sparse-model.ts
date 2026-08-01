import type { SparseEmbedding, SparseEmbeddingModel, SparseVector } from "@anvia/core/embeddings";
import { SparseEmbeddingModel as FastEmbedSparseModel, SparseTextEmbedding } from "fastembed";
import { parseSparseBatch, parseSparseVector } from "./helpers.js";
import type {
  FastEmbedSparseEmbeddingModelName,
  FastEmbedSparseEmbeddingModelOptions,
  FastEmbedSparseRuntime,
} from "./types.js";

export const DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL: FastEmbedSparseEmbeddingModelName =
  FastEmbedSparseModel.SpladePPEnV1;

export class FastEmbedSparseEmbeddingModel implements SparseEmbeddingModel {
  readonly model: string;
  readonly maxBatchSize: number;

  constructor(
    private readonly runtime: FastEmbedSparseRuntime,
    options: FastEmbedSparseEmbeddingModelOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL;
    this.maxBatchSize = Math.max(1, Math.trunc(options.maxBatchSize ?? 256));
  }

  static async create(
    options: FastEmbedSparseEmbeddingModelOptions = {},
  ): Promise<FastEmbedSparseEmbeddingModel> {
    const model = options.model ?? DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL;
    const initOptions = Object.assign({}, options.initOptions, { model });
    const runtime = await SparseTextEmbedding.init(initOptions as never);
    return new FastEmbedSparseEmbeddingModel(runtime, { ...options, model });
  }

  async embedTexts(texts: string[]): Promise<SparseEmbedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const vectors: SparseVector[] = [];
    for await (const batch of this.runtime.passageEmbed(texts, this.maxBatchSize)) {
      vectors.push(...parseSparseBatch(batch, vectors.length));
    }

    if (vectors.length !== texts.length) {
      throw new Error(
        `FastEmbed sparse embedding model returned ${vectors.length} embeddings for ${texts.length} texts`,
      );
    }

    return texts.map((document, index) => ({
      document,
      vector: vectors[index] as SparseVector,
    }));
  }

  async embedQuery(query: string): Promise<SparseEmbedding> {
    const vector = parseSparseVector(await this.runtime.queryEmbed(query), 0);
    return { document: query, vector };
  }
}

export function createFastEmbedSparseEmbeddingModel(
  options: FastEmbedSparseEmbeddingModelOptions = {},
): Promise<FastEmbedSparseEmbeddingModel> {
  return FastEmbedSparseEmbeddingModel.create(options);
}
