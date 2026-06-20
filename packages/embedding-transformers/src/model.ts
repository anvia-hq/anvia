import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import { pipeline as transformersPipeline } from "@huggingface/transformers";
import { parseVectors } from "./helpers.js";
import type {
  TransformersEmbeddingModelOptions,
  TransformersFeatureExtractionPipeline,
  TransformersPooling,
} from "./types.js";

export const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export class TransformersEmbeddingModel implements EmbeddingModel {
  readonly model: string;
  readonly maxBatchSize: number;

  private readonly pooling: TransformersPooling;
  private readonly normalize: boolean;

  constructor(
    private readonly extractor: TransformersFeatureExtractionPipeline,
    options: TransformersEmbeddingModelOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_TRANSFORMERS_EMBEDDING_MODEL;
    this.pooling = options.pooling ?? "mean";
    this.normalize = options.normalize ?? true;
    this.maxBatchSize = Math.max(1, Math.trunc(options.maxBatchSize ?? 16));
  }

  static async create(
    options: TransformersEmbeddingModelOptions = {},
  ): Promise<TransformersEmbeddingModel> {
    const model = options.model ?? DEFAULT_TRANSFORMERS_EMBEDDING_MODEL;
    const extractor = (await transformersPipeline(
      "feature-extraction",
      model,
    )) as TransformersFeatureExtractionPipeline;

    return new TransformersEmbeddingModel(extractor, { ...options, model });
  }

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    const output = await this.extractor(texts, {
      pooling: this.pooling,
      normalize: this.normalize,
    });
    const vectors = parseVectors(output.tolist(), texts.length);

    return texts.map((document, index) => ({
      document,
      vector: vectors[index] as number[],
    }));
  }
}

export function createTransformersEmbeddingModel(
  options: TransformersEmbeddingModelOptions = {},
): Promise<TransformersEmbeddingModel> {
  return TransformersEmbeddingModel.create(options);
}
