import type { EmbeddingModel, SparseEmbeddingModel } from "@anvia/core/embeddings";

export const documentIdPayloadKey = "__anvia_document_id";
export const documentPayloadKey = "__anvia_document";
export const reservedPayloadPrefix = "__anvia_";

export const defaultDenseVectorName = "dense";
export const defaultSparseVectorName = "sparse";

export type QdrantDistance = "Cosine" | "Dot" | "Euclid";

export type QdrantFusion = "rrf" | "dbsf";

export type QdrantClientLike = {
  getCollection(collectionName: string): Promise<unknown>;
  createCollection(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  upsert(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  search?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  query?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
};

export type QdrantVectorStoreConnectOptions = {
  client?: QdrantClientLike | undefined;
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: QdrantDistance | undefined;
  /** Create a named dense + sparse collection for hybrid/RRF search. */
  hybrid?: boolean | undefined;
  denseVectorName?: string | undefined;
  sparseVectorName?: string | undefined;
};

export type QdrantHybridIndexOptions = {
  dense: EmbeddingModel;
  sparse: SparseEmbeddingModel;
  fusion?: QdrantFusion | undefined;
  denseVectorName?: string | undefined;
  sparseVectorName?: string | undefined;
  prefetchLimit?: number | undefined;
};

export type QdrantIndexOptions = EmbeddingModel | QdrantHybridIndexOptions;

export function isQdrantHybridIndexOptions(
  options: QdrantIndexOptions,
): options is QdrantHybridIndexOptions {
  return (
    typeof options === "object" && options !== null && "dense" in options && "sparse" in options
  );
}
