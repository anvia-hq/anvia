import type { VectorMetric } from "@anvia/core/vector-store";
export const documentIdField = "__anvia_document_id";
export const documentField = "__anvia_document";
export const metadataField = "__anvia_metadata";
export const vectorField = "__anvia_vector";
export const reservedFieldPrefix = "__anvia_";
export const SchemaFieldTypes = {
  NUMERIC: "NUMERIC",
  TAG: "TAG",
  TEXT: "TEXT",
  VECTOR: "VECTOR",
} as const;
export const VectorAlgorithms = { HNSW: "HNSW" } as const;
export type RedisDistance = "COSINE" | "L2" | "IP";
export type RedisMetadataFieldType = "numeric" | "tag";
export type RedisMetadataSchema = Record<string, RedisMetadataFieldType>;
export type RedisClientLike = {
  ft: {
    create(
      indexName: string,
      schema: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    search(indexName: string, query: string, options?: Record<string, unknown>): Promise<unknown>;
    info(indexName: string): Promise<unknown>;
  };
  hSet(key: string, fieldValues: Record<string, unknown>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(keys: string | string[]): Promise<unknown>;
  quit?(): Promise<unknown> | unknown;
};
export type RedisVectorClientOptions = {
  client?: RedisClientLike | undefined;
  url?: string | undefined;
};
export type RedisVectorStoreOptions = {
  indexName: string;
  keyPrefix?: string | undefined;
  dimensions: number;
  metric?: VectorMetric | undefined;
  /** Metadata fields Redis Search should index. Tags support equality; numeric fields support equality and ranges. */
  metadataSchema?: RedisMetadataSchema | undefined;
};
