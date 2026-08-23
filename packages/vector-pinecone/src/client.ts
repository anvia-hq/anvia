import type { VectorMetadata } from "@anvia/core/embeddings";
import { PineconeVectorStore } from "./store.js";
import type {
  PineconeClientLike,
  PineconeVectorClientOptions,
  PineconeVectorStoreOptions,
} from "./types.js";
export class PineconeVectorClient {
  private readonly injected: PineconeClientLike | undefined;
  private clientPromise: Promise<PineconeClientLike> | undefined;
  private closed = false;
  constructor(private readonly options: PineconeVectorClientOptions = {}) {
    this.injected = options.client;
  }
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: PineconeVectorStoreOptions,
  ): PineconeVectorStore<T, Metadata> {
    this.assertOpen();
    return new PineconeVectorStore<T, Metadata>(this, options);
  }
  nativeClient(): Promise<PineconeClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined ? this.createClient() : Promise.resolve(this.injected);
    return this.clientPromise;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  private async createClient(): Promise<PineconeClientLike> {
    const { Pinecone } = await import("@pinecone-database/pinecone");
    return new Pinecone(
      this.options.apiKey === undefined ? undefined : { apiKey: this.options.apiKey },
    ) as unknown as PineconeClientLike;
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("PineconeVectorClient is closed.");
  }
}
