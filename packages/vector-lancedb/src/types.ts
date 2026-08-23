import type { VectorMetric } from "@anvia/core/vector-store";

export const documentIdColumn = "__anvia_document_id";
export const documentColumn = "__anvia_document";
export const metadataColumn = "__anvia_metadata";
export const vectorColumn = "__anvia_vector";
export const rowIdColumn = "__anvia_id";
export const reservedColumnPrefix = "__anvia_";

export type LanceDBTableLike = {
  add(rows: Record<string, unknown>[], options?: Record<string, unknown>): Promise<unknown>;
  search(vector: number[]): LanceDBQueryLike;
  countRows(): Promise<number>;
  delete(filter: string): Promise<unknown>;
  schema?(): Promise<{ fields?: Array<{ name?: string; type?: unknown }> }>;
};

export type LanceDBQueryLike = {
  limit(n: number): LanceDBQueryLike;
  where(predicate: string): LanceDBQueryLike;
  distanceType(metric: "cosine" | "l2" | "dot"): LanceDBQueryLike;
  toArray(): Promise<unknown[]>;
};

export type LanceDBConnectionLike = {
  openTable(name: string): Promise<LanceDBTableLike>;
  tableNames(): Promise<string[]>;
  createTable(name: string, data: Record<string, unknown>[]): Promise<LanceDBTableLike>;
  createEmptyTable?(
    name: string,
    schema: unknown,
    options?: Record<string, unknown>,
  ): Promise<LanceDBTableLike>;
  close?(): Promise<unknown> | unknown;
};

export type LanceDBVectorClientOptions = {
  client?: LanceDBConnectionLike | undefined;
  uri?: string | undefined;
};

export type LanceDBVectorStoreOptions = {
  tableName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
};
