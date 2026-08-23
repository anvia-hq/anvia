import type { VectorMetric } from "@anvia/core/vector-store";

export const reservedMetadataPrefix = "__anvia_";
export type PgVectorDistance = "cosine" | "l2" | "innerProduct";
export type PgVectorWhere = { sql: string; values: unknown[] };
export type PgClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(options: {
    text: string;
    values?: readonly unknown[] | undefined;
    [key: string]: unknown;
  }): Promise<{ rows: Record<string, unknown>[] }>;
  end?(): Promise<unknown> | unknown;
};
export type PgVectorClientOptions = {
  client?: PgClientLike | undefined;
  connectionString?: string | undefined;
};
export type PgVectorStoreOptions = {
  tableName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
};
