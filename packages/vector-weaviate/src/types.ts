import type { VectorMetric } from "@anvia/core/vector-store";
export const documentIdPropertyKey = "__anvia_document_id";
export const documentPropertyKey = "__anvia_document";
export const reservedPropertyPrefix = "__anvia_";
export type WeaviateDistance = "cosine" | "dot" | "l2-squared";
export type NearVectorParams = {
  limit?: number | undefined;
  filters?: unknown | undefined;
  returnMetadata?: string[] | undefined;
  returnProperties?: string[] | undefined;
};
export type WeaviateCollectionLike = {
  query: {
    nearVector(
      vector: number[],
      options?: NearVectorParams,
      callOptions?: { abortSignal?: AbortSignal | undefined },
    ): Promise<unknown>;
  };
  data?:
    | {
        deleteMany(filter: unknown, options?: Record<string, unknown>): Promise<unknown>;
        insertMany(objects: Array<Record<string, unknown>>): Promise<unknown>;
      }
    | undefined;
};
export type WeaviateCollectionsLike = {
  create(config: Record<string, unknown>): Promise<unknown>;
  get(name: string): WeaviateCollectionLike;
  exists(name: string): Promise<boolean>;
  export?(name: string): Promise<unknown>;
};
export type WeaviateClientLike = {
  collections: WeaviateCollectionsLike;
  close?(): Promise<unknown> | unknown;
};
export type WeaviateVectorClientOptions = {
  client?: WeaviateClientLike | undefined;
  httpHost?: string | undefined;
  httpPort?: number | undefined;
  grpcHost?: string | undefined;
  grpcPort?: number | undefined;
  httpSecure?: boolean | undefined;
  grpcSecure?: boolean | undefined;
};
export type WeaviateVectorStoreOptions = {
  collectionName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
};
