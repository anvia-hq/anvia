import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import { defaultPineconeClient, ensureIndex, pineconeVectors } from "./helpers.js";
import { PineconeVectorIndex } from "./search-index.js";
import type { PineconeNamespaceLike, PineconeVectorStoreConnectOptions } from "./types.js";

export class PineconeVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(private readonly namespace: PineconeNamespaceLike) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: PineconeVectorStoreConnectOptions,
  ): Promise<PineconeVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultPineconeClient());

    if (options.createIfMissing !== false) {
      await ensureIndex(client, options.indexName, options.metric ?? "cosine");
    }

    const namespace = client.index(options.indexName).namespace(options.namespace ?? "");
    return new PineconeVectorStore<T, Metadata>(namespace);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const vectors = documents.flatMap((document) => pineconeVectors(document));
    await this.namespace.upsert(vectors);
  }

  index(model: EmbeddingModel): PineconeVectorIndex<T, Metadata> {
    return new PineconeVectorIndex(model, this.namespace);
  }
}
