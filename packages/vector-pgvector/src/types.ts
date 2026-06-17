export const reservedMetadataPrefix = "__anvia_";

export type PgVectorDistance = "cosine" | "l2" | "innerProduct";

export type PgVectorWhere = {
  sql: string;
  values: unknown[];
};

export type PgClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type PgVectorStoreConnectOptions = {
  client?: PgClientLike | undefined;
  connectionString?: string | undefined;
  tableName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: PgVectorDistance | undefined;
};
