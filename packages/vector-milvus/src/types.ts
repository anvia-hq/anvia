import type { VectorMetric } from "@anvia/core/vector-store";

export const documentIdFieldName = "__anvia_document_id";
export const documentFieldName = "__anvia_document";
export const reservedFieldPrefix = "__anvia_";

export type MilvusMetric = "COSINE" | "L2" | "IP";

export type MilvusClientLike = {
  hasCollection(options: { collection_name: string }): Promise<{ value: boolean }>;
  describeCollection?(options: { collection_name: string }): Promise<unknown>;
  createCollection(options: Record<string, unknown>): Promise<unknown>;
  createIndex(options: Record<string, unknown>): Promise<unknown>;
  loadCollection(options: { collection_name: string }): Promise<unknown>;
  insert(options: Record<string, unknown>): Promise<unknown>;
  delete(options: Record<string, unknown>): Promise<unknown>;
  search(options: Record<string, unknown>): Promise<unknown>;
  closeConnection?(): Promise<unknown> | unknown;
};

export type MilvusVectorClientOptions = {
  client?: MilvusClientLike | undefined;
  address?: string | undefined;
  token?: string | undefined;
};

export type MilvusVectorStoreOptions = {
  collectionName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
};
