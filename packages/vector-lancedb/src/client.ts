import type { VectorMetadata } from "@anvia/core/embeddings";
import { defaultLanceDBConnection } from "./helpers.js";
import { LanceDBVectorStore } from "./store.js";
import type {
  LanceDBConnectionLike,
  LanceDBVectorClientOptions,
  LanceDBVectorStoreOptions,
} from "./types.js";

export class LanceDBVectorClient {
  private readonly injected: LanceDBConnectionLike | undefined;
  private clientPromise: Promise<LanceDBConnectionLike> | undefined;
  private closed = false;

  constructor(private readonly options: LanceDBVectorClientOptions = {}) {
    this.injected = options.client;
  }

  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: LanceDBVectorStoreOptions,
  ): LanceDBVectorStore<T, Metadata> {
    this.assertOpen();
    return new LanceDBVectorStore<T, Metadata>(this, options);
  }

  nativeClient(): Promise<LanceDBConnectionLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined
        ? defaultLanceDBConnection(this.options.uri)
        : Promise.resolve(this.injected);
    return this.clientPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    await (await this.clientPromise).close?.();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("LanceDBVectorClient is closed.");
  }
}
