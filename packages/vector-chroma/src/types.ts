import type { VectorMetric } from "@anvia/core/vector-store";

export type ChromaClientLike = {
  getCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  createCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  getOrCreateCollection?(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  close?(): Promise<unknown> | unknown;
};

export type ChromaCollectionLike = {
  configuration?: { hnsw?: { space?: unknown } | null } | undefined;
  metadata?: Record<string, unknown> | undefined;
  upsert(options: Record<string, unknown>): Promise<unknown>;
  delete(options: Record<string, unknown>): Promise<unknown>;
  query(options: Record<string, unknown>): Promise<unknown>;
};

export type ChromaVectorClientOptions = {
  client?: ChromaClientLike | undefined;
  path?: string | undefined;
};

export type ChromaVectorStoreOptions = {
  collectionName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
  metadata?: Record<string, unknown> | undefined;
  configuration?: Record<string, unknown> | undefined;
};
