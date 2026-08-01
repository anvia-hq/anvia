import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import { defaultQdrantClient, qdrantPoints } from "./helpers.js";
import { QdrantVectorIndex } from "./search-index.js";
import {
  defaultDenseVectorName,
  defaultSparseVectorName,
  isQdrantHybridIndexOptions,
  type QdrantClientLike,
  type QdrantIndexOptions,
  type QdrantVectorStoreConnectOptions,
} from "./types.js";

export class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
    private readonly options: {
      hybrid: boolean;
      denseVectorName: string;
      sparseVectorName: string;
    },
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreConnectOptions,
  ): Promise<QdrantVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultQdrantClient());
    const hybrid = options.hybrid === true;
    const denseVectorName = options.denseVectorName ?? defaultDenseVectorName;
    const sparseVectorName = options.sparseVectorName ?? defaultSparseVectorName;
    const storeOptions = { hybrid, denseVectorName, sparseVectorName };

    if (options.createIfMissing === false) {
      await client.getCollection(options.collectionName);
      return new QdrantVectorStore<T, Metadata>(client, options.collectionName, storeOptions);
    }

    try {
      await client.getCollection(options.collectionName);
    } catch {
      if (hybrid) {
        await client.createCollection(options.collectionName, {
          vectors: {
            [denseVectorName]: {
              size: options.vectorSize,
              distance: options.distance ?? "Cosine",
            },
          },
          sparse_vectors: {
            [sparseVectorName]: {},
          },
        });
      } else {
        await client.createCollection(options.collectionName, {
          vectors: {
            size: options.vectorSize,
            distance: options.distance ?? "Cosine",
          },
        });
      }
    }
    return new QdrantVectorStore<T, Metadata>(client, options.collectionName, storeOptions);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const points = documents.flatMap((document) =>
      qdrantPoints(document, {
        hybrid: this.options.hybrid,
        denseVectorName: this.options.denseVectorName,
        sparseVectorName: this.options.sparseVectorName,
      }),
    );
    await this.client.upsert(this.collectionName, { points });
  }

  index(options: QdrantIndexOptions): QdrantVectorIndex<T, Metadata> {
    if (isQdrantHybridIndexOptions(options)) {
      if (!this.options.hybrid) {
        throw new TypeError(
          "Hybrid Qdrant index requires QdrantVectorStore.connect({ hybrid: true }).",
        );
      }
      return new QdrantVectorIndex(options.dense, this.client, this.collectionName, {
        sparse: options.sparse,
        fusion: options.fusion ?? "rrf",
        denseVectorName: options.denseVectorName ?? this.options.denseVectorName,
        sparseVectorName: options.sparseVectorName ?? this.options.sparseVectorName,
        prefetchLimit: options.prefetchLimit,
      });
    }
    if (this.options.hybrid) {
      throw new TypeError(
        "Dense-only Qdrant index requires store.index({ dense, sparse }) when the collection was created with hybrid: true.",
      );
    }
    return new QdrantVectorIndex(options as EmbeddingModel, this.client, this.collectionName);
  }
}
