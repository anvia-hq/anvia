import type { VectorMetadata } from "@anvia/core/embeddings";
import { MilvusVectorStore } from "./store.js";
import type {
  MilvusClientLike,
  MilvusVectorClientOptions,
  MilvusVectorStoreOptions,
} from "./types.js";

export class MilvusVectorClient {
  private readonly injected: MilvusClientLike | undefined;
  private clientPromise: Promise<MilvusClientLike> | undefined;
  private closed = false;

  constructor(private readonly options: MilvusVectorClientOptions = {}) {
    this.injected = options.client;
  }

  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: MilvusVectorStoreOptions,
  ): MilvusVectorStore<T, Metadata> {
    this.assertOpen();
    return new MilvusVectorStore<T, Metadata>(this, options);
  }

  nativeClient(): Promise<MilvusClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined ? this.createClient() : Promise.resolve(this.injected);
    return this.clientPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    await (await this.clientPromise).closeConnection?.();
  }

  private async createClient(): Promise<MilvusClientLike> {
    const { MilvusClient } = await import("@zilliz/milvus2-sdk-node");
    return new MilvusClient({
      address: this.options.address ?? "localhost:19530",
      ...(this.options.token === undefined ? {} : { token: this.options.token }),
    }) as unknown as MilvusClientLike;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("MilvusVectorClient is closed.");
  }
}
