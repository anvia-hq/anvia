export const documentIdField = "__anvia_document_id";
export const documentField = "__anvia_document";
export const vectorField = "__anvia_vector";
export const reservedFieldPrefix = "__anvia_";

export const SchemaFieldTypes = {
  TEXT: "TEXT",
  VECTOR: "VECTOR",
} as const;

export const VectorAlgorithms = {
  HNSW: "HNSW",
} as const;

export type RedisDistance = "COSINE" | "L2" | "IP";

export type RedisClientLike = {
  ft: {
    create(
      indexName: string,
      schema: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    search(indexName: string, query: string, options?: Record<string, unknown>): Promise<unknown>;
    dropindex(indexName: string): Promise<unknown>;
    info(indexName: string): Promise<unknown>;
  };
  hSet(key: string, fieldValues: Record<string, unknown>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export type RedisVectorStoreConnectOptions = {
  client?: RedisClientLike | undefined;
  indexName: string;
  keyPrefix?: string | undefined;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: RedisDistance | undefined;
};
