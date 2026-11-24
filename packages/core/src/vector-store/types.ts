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

export type VectorFilterComparisonOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export type VectorFilterOperator = VectorFilterComparisonOperator | "in" | "and" | "or";

/** Non-empty list of child filters. Existing two-element tuples remain valid. */
export type VectorFilterList = [VectorFilter, ...VectorFilter[]];

export type VectorFilter =
  | { type: "eq"; key: string; value: VectorMetadataValue }
  | { type: "ne"; key: string; value: VectorMetadataValue }
  | { type: "gt"; key: string; value: VectorMetadataValue }
  | { type: "gte"; key: string; value: VectorMetadataValue }
  | { type: "lt"; key: string; value: VectorMetadataValue }
  | { type: "lte"; key: string; value: VectorMetadataValue }
  | { type: "in"; key: string; values: VectorMetadataValue[] }
  | { type: "and"; filters: VectorFilterList }
  | { type: "or"; filters: VectorFilterList };

export type VectorFilterFieldOperators = Readonly<{
  eq?: VectorMetadataValue;
  ne?: VectorMetadataValue;
  gt?: VectorMetadataValue;
  gte?: VectorMetadataValue;
  lt?: VectorMetadataValue;
  lte?: VectorMetadataValue;
  in?: readonly VectorMetadataValue[];
}>;

export type VectorFilterShorthand = Readonly<
  Record<string, VectorMetadataValue | VectorFilterFieldOperators>
>;

export type VectorFilterInput = VectorFilter | VectorFilterShorthand;

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

export type VectorStoreDeleteOptions = {
  documentIds: readonly string[];
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
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
  /** The specific embedded chunk text that produced the best score, when available. */
  matchedText?: string | undefined;
};

export type VectorRerankOptions<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> = Readonly<{
  query: string;
  results: readonly VectorSearchResult<T, Metadata>[];
  abortSignal?: AbortSignal | undefined;
}>;

export type VectorReranker<T = unknown, Metadata extends VectorMetadata = VectorMetadata> = (
  options: VectorRerankOptions<T, Metadata>,
) =>
  | Promise<readonly VectorSearchResult<T, Metadata>[]>
  | readonly VectorSearchResult<T, Metadata>[];

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
  delete?(options: VectorStoreDeleteOptions): Promise<void>;
  search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
  inspect?(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>>;
}

export interface HybridVectorStore<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> extends VectorStore<T, Metadata> {
  searchHybrid(request: HybridVectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
}

export type RetrieveDocumentsBaseOptions<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> = {
  query: string;
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  rerank?: VectorReranker<T, Metadata> | undefined;
  candidateTopK?: number | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type RetrieveDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = RetrieveDocumentsBaseOptions<T, Metadata> & {
  store: VectorStore<T, Metadata>;
  model: EmbeddingModel;
  models?: never;
};

export type RetrieveHybridDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = RetrieveDocumentsBaseOptions<T, Metadata> & {
  store: HybridVectorStore<T, Metadata>;
  model?: never;
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
  fusion?: VectorFusion | undefined;
};

export type VectorSearchToolBaseOptions<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> = {
  name: string;
  description?: string | undefined;
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  rerank?: VectorReranker<T, Metadata> | undefined;
  candidateTopK?: number | undefined;
  retries?: RetrySetting | undefined;
};

export type DenseVectorSearchToolOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = VectorSearchToolBaseOptions<T, Metadata> & {
  store: VectorStore<T, Metadata>;
  model: EmbeddingModel;
  models?: never;
};

export type HybridVectorSearchToolOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = VectorSearchToolBaseOptions<T, Metadata> & {
  store: HybridVectorStore<T, Metadata>;
  model?: never;
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
  fusion?: VectorFusion | undefined;
};

export type VectorSearchToolOptions<
  T = unknown,
  Metadata extends VectorMetadata = VectorMetadata,
> = DenseVectorSearchToolOptions<T, Metadata> | HybridVectorSearchToolOptions<T, Metadata>;
