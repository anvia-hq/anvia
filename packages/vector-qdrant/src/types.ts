import type { EmbeddingModel, SparseEmbeddingModel } from "@anvia/core/embeddings";
import type { QdrantClientParams } from "@qdrant/js-client-rest";

export const documentIdPayloadKey = "__anvia_document_id";
export const documentPayloadKey = "__anvia_document";
export const reservedPayloadPrefix = "__anvia_";

export const defaultDenseVectorName = "dense";
export const defaultSparseVectorName = "sparse";

export type QdrantDistance = "Cosine" | "Dot" | "Euclid" | "Manhattan";

export type QdrantFusion = "rrf" | "dbsf";

export type QdrantClientLike = {
  getCollection(collectionName: string): Promise<unknown>;
  createCollection(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  upsert(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  batchUpdate?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  collectionExists?(collectionName: string): Promise<unknown>;
  delete?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  scroll?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  search?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  query?(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
};

type QdrantVectorStoreBaseConnectOptions = {
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: QdrantDistance | undefined;
  /** Create a named dense + sparse collection for hybrid/RRF search. */
  hybrid?: boolean | undefined;
  denseVectorName?: string | undefined;
  sparseVectorName?: string | undefined;
};

export type QdrantVectorStoreConnectOptions = QdrantVectorStoreBaseConnectOptions &
  (
    | {
        client: QdrantClientLike;
        clientOptions?: never;
      }
    | {
        client?: undefined;
        clientOptions?: QdrantClientParams | undefined;
      }
  );

export type QdrantMutationOptions = {
  /** Wait until Qdrant has applied the mutation. Defaults to true. */
  wait?: boolean | undefined;
  ordering?: "weak" | "medium" | "strong" | undefined;
  timeout?: number | undefined;
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
