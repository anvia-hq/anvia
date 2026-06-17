export type ChromaClientLike = {
  getCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  createCollection(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
  getOrCreateCollection?(options: Record<string, unknown>): Promise<ChromaCollectionLike>;
};

export type ChromaCollectionLike = {
  upsert(options: Record<string, unknown>): Promise<unknown>;
  query(options: Record<string, unknown>): Promise<unknown>;
};

export type ChromaVectorStoreConnectOptions = {
  client?: ChromaClientLike | undefined;
  collectionName: string;
  createIfMissing?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  configuration?: Record<string, unknown> | undefined;
};
