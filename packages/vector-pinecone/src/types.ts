import type { JsonObject } from "@anvia/core/completion";
import type { VectorMetric } from "@anvia/core/vector-store";
export const documentIdMetadataKey = "__anvia_document_id";
export const documentMetadataKey = "__anvia_document";
export const reservedMetadataPrefix = "__anvia_";
export type PineconeMetric = "cosine" | "euclidean" | "dotproduct";
export type PineconeClientLike = {
  listIndexes(): Promise<unknown>;
  createIndex(options: Record<string, unknown>): Promise<unknown>;
  describeIndex?(indexName: string): Promise<unknown>;
  index(indexName: string): PineconeIndexLike;
};
export type PineconeIndexLike = { namespace(namespace: string): PineconeNamespaceLike };
export type PineconeNamespaceLike = {
  upsert(options: {
    records: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): Promise<unknown>;
  deleteMany(options: Record<string, unknown>): Promise<unknown>;
  query(options: Record<string, unknown>): Promise<unknown>;
};
export type PineconeVectorClientOptions = {
  client?: PineconeClientLike | undefined;
  apiKey?: string | undefined;
};
export type PineconeVectorStoreOptions = {
  indexName: string;
  namespace?: string | undefined;
  dimensions: number;
  metric?: VectorMetric | undefined;
  spec?: JsonObject | undefined;
};
