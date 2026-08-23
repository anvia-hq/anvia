import type { VectorMetadata } from "@anvia/core/embeddings";
import { defaultPgClient } from "./helpers.js";
import { PgVectorStore } from "./store.js";
import type { PgClientLike, PgVectorClientOptions, PgVectorStoreOptions } from "./types.js";

export class PgVectorClient {
  private readonly injected: PgClientLike | undefined;
  private clientPromise: Promise<PgClientLike> | undefined;
  private closed = false;
  constructor(private readonly options: PgVectorClientOptions = {}) {
    this.injected = options.client;
  }
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: PgVectorStoreOptions,
  ): PgVectorStore<T, Metadata> {
    this.assertOpen();
    return new PgVectorStore<T, Metadata>(this, options);
  }
  nativeClient(): Promise<PgClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined
        ? defaultPgClient(this.options.connectionString)
        : Promise.resolve(this.injected);
    return this.clientPromise;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    await (await this.clientPromise).end?.();
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("PgVectorClient is closed.");
  }
}
