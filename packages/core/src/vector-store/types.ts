import type { VectorMetadata, VectorMetadataValue } from "../embeddings";
import type { Tool } from "../tool/tool";

export type VectorFilter =
  | { type: "eq"; key: string; value: VectorMetadataValue }
  | { type: "gt"; key: string; value: VectorMetadataValue }
  | { type: "lt"; key: string; value: VectorMetadataValue }
  | { type: "and"; filters: [VectorFilter, VectorFilter] }
  | { type: "or"; filters: [VectorFilter, VectorFilter] };

export type LshOptions = {
  type: "lsh";
  numTables: number;
  numHyperplanes: number;
  seed?: number | undefined;
};

export type IndexStrategy = { type: "bruteForce" } | LshOptions;

export type VectorSearchRequest = {
  query: string;
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
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

export interface VectorSearchIndex<T = unknown, Metadata extends VectorMetadata = VectorMetadata> {
  search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>>;
  searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>>;
  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown>;
  inspect?(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>>;
}

export type VectorSearchToolOptions = {
  name: string;
  description?: string | undefined;
  topK?: number | undefined;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
};
