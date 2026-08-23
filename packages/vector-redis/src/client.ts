import type { VectorMetadata } from "@anvia/core/embeddings";
import { RedisVectorStore } from "./store.js";
import type {
  RedisClientLike,
  RedisVectorClientOptions,
  RedisVectorStoreOptions,
} from "./types.js";
export class RedisVectorClient {
  private readonly injected: RedisClientLike | undefined;
  private clientPromise: Promise<RedisClientLike> | undefined;
  private closed = false;
  constructor(private readonly options: RedisVectorClientOptions = {}) {
    this.injected = options.client;
  }
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: RedisVectorStoreOptions,
  ): RedisVectorStore<T, Metadata> {
    this.assertOpen();
    return new RedisVectorStore<T, Metadata>(this, options);
  }
  nativeClient(): Promise<RedisClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined ? this.createClient() : Promise.resolve(this.injected);
    return this.clientPromise;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    await (await this.clientPromise).quit?.();
  }
  private async createClient(): Promise<RedisClientLike> {
    const redis = await import("redis");
    const client = redis.createClient({
      url: this.options.url ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    });
    await client.connect();
    return client as unknown as RedisClientLike;
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("RedisVectorClient is closed.");
  }
}
