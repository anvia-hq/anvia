export const documentIdMetadataKey = "__anvia_document_id";
export const documentMetadataKey = "__anvia_document";
export const reservedMetadataPrefix = "__anvia_";

export type PineconeMetric = "cosine" | "euclidean" | "dotproduct";

export type PineconeClientLike = {
  listIndexes(): Promise<unknown>;
  createIndex(options: Record<string, unknown>): Promise<unknown>;
  index(indexName: string): PineconeIndexLike;
};

export type PineconeIndexLike = {
  namespace(namespace: string): PineconeNamespaceLike;
};

export type PineconeNamespaceLike = {
  upsert(vectors: Array<Record<string, unknown>>): Promise<unknown>;
  query(options: Record<string, unknown>): Promise<unknown>;
};

export type PineconeVectorStoreConnectOptions = {
  client?: PineconeClientLike | undefined;
  indexName: string;
  namespace?: string | undefined;
  createIfMissing?: boolean | undefined;
  metric?: PineconeMetric | undefined;
};
