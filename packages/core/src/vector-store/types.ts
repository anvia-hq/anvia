import type { JsonObject } from "../completion";
import type {
  EmbeddedDocument,
  EmbeddingModel,
  SparseEmbeddingModel,
  SparseVector,
  VectorMetadata,
  VectorMetadataValue,
} from "../embeddings";
import type { RetrySetting } from "../retry";

export type VectorFilter =
  | { type: "eq"; key: string; value: VectorMetadataValue }
  | { type: "gt"; key: string; value: VectorMetadataValue }
  | { type: "lt"; key: string; value: VectorMetadataValue }
  | { type: "and"; filters: [VectorFilter, VectorFilter] }
  | { type: "or"; filters: [VectorFilter, VectorFilter] };

export type VectorMetric = "cosine" | "euclidean" | "dotProduct";
export type VectorFusion = "rrf" | "dbsf";

export type LshOptions = {
  type: "lsh";
  numTables: number;
  numHyperplanes: number;
  seed?: number | undefined;
};

export type IndexStrategy = { type: "bruteForce" } | LshOptions;

export type VectorStoreUpsertOptions<T, Metadata extends VectorMetadata = VectorMetadata> = {
  documents: Array<EmbeddedDocument<T, Metadata>>;
  providerOptions?: JsonObject | undefined;
};

export type VectorSearchRequest = {
  vector: number[];
  topK: number;
  minScore?: number | undefined;
  filter?: VectorFilter | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type HybridVectorSearchRequest = VectorSearchRequest & {
  sparseVector: SparseVector;
  fusion?: VectorFusion | undefined;
};

export type VectorSearchResult<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  score: number;
  id: string;
  document: T;
  metadata?: Metadata | undefined;
};

export type VectorInspectRequest = {
  limit: number;
  cursor?: string | undefined;
  filter?: VectorFilter | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type VectorInspectItem<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  document: T;
  metadata?: Metadata | undefined;
};

export type VectorInspectPage<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = {
  items: Array<VectorInspectItem<T, Metadata>>;
  nextCursor?: string | undefined;
  totalCount?: number | undefined;
};

export interface VectorStore<T = unknown, Metadata extends VectorMetadata = VectorMetadata> {
  ensure(): Promise<void>;
  validate(): Promise<void>;
  upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void>;
  search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
  inspect?(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>>;
}

export interface HybridVectorStore<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> extends VectorStore<T, Metadata> {
  searchHybrid(request: HybridVectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
}

export type RetrieveDocumentsBaseOptions = {
  query: string;
  topK: number;
  minScore?: number | undefined;
  filter?: VectorFilter | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type RetrieveDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = RetrieveDocumentsBaseOptions & {
  store: VectorStore<T, Metadata>;
  model: EmbeddingModel;
  models?: never;
};

export type RetrieveHybridDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = RetrieveDocumentsBaseOptions & {
  store: HybridVectorStore<T, Metadata>;
  model?: never;
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
  fusion?: VectorFusion | undefined;
};

export type VectorSearchToolBaseOptions = {
  name: string;
  description?: string | undefined;
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilter | undefined;
  retries?: RetrySetting | undefined;
};

export type DenseVectorSearchToolOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = VectorSearchToolBaseOptions & {
  store: VectorStore<T, Metadata>;
  model: EmbeddingModel;
  models?: never;
};

export type HybridVectorSearchToolOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = VectorSearchToolBaseOptions & {
  store: HybridVectorStore<T, Metadata>;
  model?: never;
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
  fusion?: VectorFusion | undefined;
};

export type VectorSearchToolOptions<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> = DenseVectorSearchToolOptions<T, Metadata> | HybridVectorSearchToolOptions<T, Metadata>;
