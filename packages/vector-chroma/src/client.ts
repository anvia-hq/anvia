import type { VectorMetadata } from "@anvia/core/embeddings";
import { ChromaVectorStore } from "./store.js";
import type {
  ChromaClientLike,
  ChromaVectorClientOptions,
  ChromaVectorStoreOptions,
} from "./types.js";

export class ChromaVectorClient {
  private readonly injected: ChromaClientLike | undefined;
  private clientPromise: Promise<ChromaClientLike> | undefined;
  private closed = false;

  constructor(private readonly options: ChromaVectorClientOptions = {}) {
    this.injected = options.client;
  }

  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: ChromaVectorStoreOptions,
  ): ChromaVectorStore<T, Metadata> {
    this.assertOpen();
    return new ChromaVectorStore<T, Metadata>(this, options);
  }

  nativeClient(): Promise<ChromaClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined ? this.createClient() : Promise.resolve(this.injected);
    return this.clientPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    const client = await this.clientPromise;
    await client.close?.();
  }

  private async createClient(): Promise<ChromaClientLike> {
    const chroma = await import("chromadb");
    return new chroma.ChromaClient(
      this.options.path === undefined ? undefined : { path: this.options.path },
    ) as ChromaClientLike;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("ChromaVectorClient is closed.");
  }
}
