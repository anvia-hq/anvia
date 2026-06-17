import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import { defaultQdrantClient, qdrantPoints } from "./helpers.js";
import { QdrantVectorIndex } from "./search-index.js";
import type { QdrantClientLike, QdrantVectorStoreConnectOptions } from "./types.js";

export class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreConnectOptions,
  ): Promise<QdrantVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultQdrantClient());
    if (options.createIfMissing === false) {
      await client.getCollection(options.collectionName);
      return new QdrantVectorStore<T, Metadata>(client, options.collectionName);
    }

    try {
      await client.getCollection(options.collectionName);
    } catch {
      await client.createCollection(options.collectionName, {
        vectors: {
          size: options.vectorSize,
          distance: options.distance ?? "Cosine",
        },
      });
    }
    return new QdrantVectorStore<T, Metadata>(client, options.collectionName);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const points = documents.flatMap((document) => qdrantPoints(document));
    await this.client.upsert(this.collectionName, { points });
  }

  index(model: EmbeddingModel): QdrantVectorIndex<T, Metadata> {
    return new QdrantVectorIndex(model, this.client, this.collectionName);
  }
}
