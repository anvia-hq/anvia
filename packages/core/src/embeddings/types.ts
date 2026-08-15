import type { ModelCallOptions } from "../model-call-options";
import type { RetrySetting } from "../retry";

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
  embedTexts(texts: string[], options?: ModelCallOptions | undefined): Promise<Embedding[]>;
}

/** Sparse lexical/neural encoder used for hybrid retrieval channels. */
export interface SparseEmbeddingModel {
  readonly maxBatchSize?: number | undefined;
  /** Embed passage/document texts for indexing. */
  embedTexts(texts: string[], options?: ModelCallOptions | undefined): Promise<SparseEmbedding[]>;
  /** Embed a search query (may differ from passage encoding for models like SPLADE). */
  embedQuery(query: string, options?: ModelCallOptions | undefined): Promise<SparseEmbedding>;
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

export type EmbeddingOperationOptions = {
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type EmbedTextOptions = EmbeddingOperationOptions & {
  model: EmbeddingModel;
  text: string;
};

export type EmbedTextsOptions = EmbeddingOperationOptions & {
  model: EmbeddingModel;
  texts: string[];
  concurrency?: number | undefined;
};

export type EmbedSparseTextsOptions = EmbeddingOperationOptions & {
  model: SparseEmbeddingModel;
  texts: string[];
  concurrency?: number | undefined;
};

export type EmbedSparseQueryOptions = EmbeddingOperationOptions & {
  model: SparseEmbeddingModel;
  query: string;
};

export type EmbedDocumentsBaseOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = EmbeddingOperationOptions & {
  documents: T[];
  id?: ((document: T, index: number) => string) | undefined;
  content(document: T, index: number): string | string[];
  metadata?: ((document: T, index: number) => Metadata | undefined) | undefined;
  concurrency?: number | undefined;
};

export type EmbedDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = EmbedDocumentsBaseOptions<T, Metadata> & {
  model: EmbeddingModel;
  models?: never;
};

export type EmbedHybridDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = EmbedDocumentsBaseOptions<T, Metadata> & {
  model?: never;
  models: {
    dense: EmbeddingModel;
    sparse: SparseEmbeddingModel;
  };
};

export type EmbedTextResult = { embedding: Embedding };
export type EmbedTextsResult = { embeddings: Embedding[] };
export type EmbedSparseTextsResult = { embeddings: SparseEmbedding[] };
export type EmbedSparseQueryResult = { embedding: SparseEmbedding };
export type EmbedDocumentsResult<T, Metadata extends VectorMetadata = VectorMetadata> = {
  documents: Array<EmbeddedDocument<T, Metadata>>;
};
