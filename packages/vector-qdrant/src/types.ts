import type { JsonObject } from "@anvia/core/completion";
import type { VectorFusion, VectorMetric } from "@anvia/core/vector-store";
import type { QdrantClientParams } from "@qdrant/js-client-rest";
export const documentIdPayloadKey = "__anvia_document_id";
export const documentPayloadKey = "__anvia_document";
export const reservedPayloadPrefix = "__anvia_";
export const defaultDenseVectorName = "dense";
export const defaultSparseVectorName = "sparse";
export type QdrantDistance = "Cosine" | "Dot" | "Euclid";
export type QdrantFusion = VectorFusion;
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
export type QdrantVectorClientOptions = QdrantClientParams & {
  client?: QdrantClientLike | undefined;
};
export type QdrantVectorStoreBaseOptions = {
  collectionName: string;
  dimensions: number;
  metric?: VectorMetric | undefined;
  denseVectorName?: string | undefined;
};
export type QdrantDenseVectorStoreOptions = QdrantVectorStoreBaseOptions & {
  mode?: "dense" | undefined;
  sparseVectorName?: never;
};
export type QdrantHybridVectorStoreOptions = QdrantVectorStoreBaseOptions & {
  mode: "hybrid";
  sparseVectorName?: string | undefined;
};
export type QdrantVectorStoreOptions =
  | QdrantDenseVectorStoreOptions
  | QdrantHybridVectorStoreOptions;
export type QdrantMutationOptions = JsonObject & {
  wait?: boolean | undefined;
  ordering?: "weak" | "medium" | "strong" | undefined;
  timeout?: number | undefined;
};
