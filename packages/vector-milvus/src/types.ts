export const documentIdFieldName = "__anvia_document_id";
export const documentFieldName = "__anvia_document";
export const reservedFieldPrefix = "__anvia_";

export type MilvusMetric = "COSINE" | "L2" | "IP";

export type MilvusClientLike = {
  hasCollection(options: { collection_name: string }): Promise<{ value: boolean }>;
  createCollection(options: Record<string, unknown>): Promise<unknown>;
  createIndex(options: Record<string, unknown>): Promise<unknown>;
  loadCollection(options: { collection_name: string }): Promise<unknown>;
  insert(options: Record<string, unknown>): Promise<unknown>;
  search(options: Record<string, unknown>): Promise<unknown>;
};

export type MilvusVectorStoreConnectOptions = {
  client?: MilvusClientLike | undefined;
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  metric?: MilvusMetric | undefined;
};
