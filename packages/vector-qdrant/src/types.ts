export const documentIdPayloadKey = "__anvia_document_id";
export const documentPayloadKey = "__anvia_document";
export const reservedPayloadPrefix = "__anvia_";

export type QdrantDistance = "Cosine" | "Dot" | "Euclid";

export type QdrantClientLike = {
  getCollection(collectionName: string): Promise<unknown>;
  createCollection(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  upsert(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  search(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
};

export type QdrantVectorStoreConnectOptions = {
  client?: QdrantClientLike | undefined;
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: QdrantDistance | undefined;
};
