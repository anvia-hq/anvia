import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import { chromaRecords, defaultChromaClient, getOrCreateCollection } from "./helpers.js";
import { ChromaVectorIndex } from "./search-index.js";
import type { ChromaCollectionLike, ChromaVectorStoreConnectOptions } from "./types.js";

export class ChromaVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(private readonly collection: ChromaCollectionLike) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: ChromaVectorStoreConnectOptions,
  ): Promise<ChromaVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultChromaClient());
    const collectionOptions = {
      name: options.collectionName,
      metadata: options.metadata ?? { "hnsw:space": "cosine" },
      configuration: options.configuration,
      embeddingFunction: null,
    };
    const collection =
      options.createIfMissing === false
        ? await client.getCollection(collectionOptions)
        : client.getOrCreateCollection !== undefined
          ? await client.getOrCreateCollection(collectionOptions)
          : await getOrCreateCollection(client, collectionOptions);
    return new ChromaVectorStore<T, Metadata>(collection);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const records = documents.flatMap((document) => chromaRecords(document));
    await this.collection.upsert({
      ids: records.map((record) => record.id),
      documents: records.map((record) => record.document),
      embeddings: records.map((record) => record.embedding),
      ...(records.some((record) => record.metadata !== undefined)
        ? { metadatas: records.map((record) => record.metadata ?? null) }
        : {}),
    });
  }

  index(model: EmbeddingModel): ChromaVectorIndex<T, Metadata> {
    return new ChromaVectorIndex(model, this.collection);
  }
}
