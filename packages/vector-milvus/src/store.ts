import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import { defaultMilvusClient, ensureCollection, milvusRows } from "./helpers.js";
import { MilvusVectorIndex } from "./search-index.js";
import type { MilvusClientLike, MilvusVectorStoreConnectOptions } from "./types.js";

export class MilvusVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: MilvusClientLike,
    private readonly collectionName: string,
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: MilvusVectorStoreConnectOptions,
  ): Promise<MilvusVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultMilvusClient());

    if (options.createIfMissing !== false) {
      await ensureCollection(
        client,
        options.collectionName,
        options.vectorSize,
        options.metric ?? "COSINE",
      );
    }

    await client.loadCollection({ collection_name: options.collectionName });
    return new MilvusVectorStore<T, Metadata>(client, options.collectionName);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const rows = documents.flatMap((document) => milvusRows(document));
    await this.client.insert({
      collection_name: this.collectionName,
      data: rows,
    });
  }

  index(model: EmbeddingModel): MilvusVectorIndex<T, Metadata> {
    return new MilvusVectorIndex(model, this.client, this.collectionName);
  }
}
