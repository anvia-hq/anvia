import type { VectorMetadata } from "@anvia/core/embeddings";
import { defaultQdrantClient } from "./helpers.js";
import { QdrantHybridVectorStore, QdrantVectorStore } from "./store.js";
import type {
  QdrantClientLike,
  QdrantDenseVectorStoreOptions,
  QdrantHybridVectorStoreOptions,
  QdrantVectorClientOptions,
  QdrantVectorStoreOptions,
} from "./types.js";
export class QdrantVectorClient {
  private readonly injected: QdrantClientLike | undefined;
  private clientPromise: Promise<QdrantClientLike> | undefined;
  private closed = false;
  constructor(private readonly options: QdrantVectorClientOptions = {}) {
    this.injected = options.client;
  }
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantHybridVectorStoreOptions,
  ): QdrantHybridVectorStore<T, Metadata>;
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantDenseVectorStoreOptions,
  ): QdrantVectorStore<T, Metadata>;
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreOptions,
  ): QdrantVectorStore<T, Metadata> | QdrantHybridVectorStore<T, Metadata> {
    this.assertOpen();
    return options.mode === "hybrid"
      ? new QdrantHybridVectorStore<T, Metadata>(this, options)
      : new QdrantVectorStore<T, Metadata>(this, options);
  }
  nativeClient(): Promise<QdrantClientLike> {
    this.assertOpen();
    const { client: _client, ...clientOptions } = this.options;
    this.clientPromise ??=
      this.injected === undefined
        ? defaultQdrantClient(clientOptions)
        : Promise.resolve(this.injected);
    return this.clientPromise;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("QdrantVectorClient is closed.");
  }
}
