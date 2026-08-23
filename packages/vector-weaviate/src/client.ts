import type { VectorMetadata } from "@anvia/core/embeddings";
import { WeaviateVectorStore } from "./store.js";
import type {
  WeaviateClientLike,
  WeaviateVectorClientOptions,
  WeaviateVectorStoreOptions,
} from "./types.js";
export class WeaviateVectorClient {
  private readonly injected: WeaviateClientLike | undefined;
  private clientPromise: Promise<WeaviateClientLike> | undefined;
  private closed = false;
  constructor(private readonly options: WeaviateVectorClientOptions = {}) {
    this.injected = options.client;
  }
  vectorStore<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: WeaviateVectorStoreOptions,
  ): WeaviateVectorStore<T, Metadata> {
    this.assertOpen();
    return new WeaviateVectorStore<T, Metadata>(this, options);
  }
  nativeClient(): Promise<WeaviateClientLike> {
    this.assertOpen();
    this.clientPromise ??=
      this.injected === undefined ? this.createClient() : Promise.resolve(this.injected);
    return this.clientPromise;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.injected !== undefined || this.clientPromise === undefined) return;
    await (await this.clientPromise).close?.();
  }
  private async createClient(): Promise<WeaviateClientLike> {
    const module = await import("weaviate-client");
    const weaviate = module.default ?? module;
    return (await weaviate.connectToCustom({
      httpHost: this.options.httpHost ?? process.env.WEAVIATE_HOST ?? "localhost",
      httpPort: port(this.options.httpPort, process.env.WEAVIATE_HTTP_PORT, 8080, "HTTP"),
      httpSecure: this.options.httpSecure ?? false,
      grpcHost: this.options.grpcHost ?? process.env.WEAVIATE_GRPC_HOST ?? "localhost",
      grpcPort: port(this.options.grpcPort, process.env.WEAVIATE_GRPC_PORT, 50051, "gRPC"),
      grpcSecure: this.options.grpcSecure ?? false,
    })) as unknown as WeaviateClientLike;
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("WeaviateVectorClient is closed.");
  }
}

function port(
  configured: number | undefined,
  environment: string | undefined,
  fallback: number,
  protocol: string,
): number {
  const value = configured ?? (environment === undefined ? fallback : Number(environment));
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new RangeError(`Weaviate ${protocol} port must be an integer between 1 and 65535.`);
  }
  return value;
}
