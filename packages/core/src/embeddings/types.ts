export type Embedding = {
  document: string;
  vector: number[];
};

export type SparseVector = {
  indices: number[];
  values: number[];
};

export type SparseEmbedding = {
  document: string;
  vector: SparseVector;
};

export interface EmbeddingModel {
  readonly dimensions?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  embedTexts(texts: string[]): Promise<Embedding[]>;
}

/** Sparse lexical/neural encoder used for hybrid retrieval channels. */
export interface SparseEmbeddingModel {
  readonly maxBatchSize?: number | undefined;
  /** Embed passage/document texts for indexing. */
  embedTexts(texts: string[]): Promise<SparseEmbedding[]>;
  /** Embed a search query (may differ from passage encoding for models like SPLADE). */
  embedQuery(query: string): Promise<SparseEmbedding>;
}

export type EmbeddedDocument<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  document: T;
  metadata?: Metadata | undefined;
  embeddings: Embedding[];
  /** Optional sparse vectors aligned 1:1 with `embeddings` by chunk index. */
  sparseEmbeddings?: SparseEmbedding[] | undefined;
};

export type VectorMetadataValue = string | number | boolean | null;
export type VectorMetadata = Record<string, VectorMetadataValue>;

export type EmbedDocumentsOptions<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id?: ((document: T, index: number) => string) | undefined;
  content(document: T, index: number): string | string[];
  metadata?: ((document: T, index: number) => Metadata | undefined) | undefined;
  concurrency?: number | undefined;
};

export type EmbedHybridDocumentsOptions = {
  dense: EmbeddingModel;
  sparse: SparseEmbeddingModel;
};
