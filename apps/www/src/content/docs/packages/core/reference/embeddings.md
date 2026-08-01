---
title: "Embeddings"
description: "Embedding model contracts, document embedding helpers, and vector math."
section: packages
sidebar:
  group: "Reference"
  order: 12
  label: "Embeddings"
---
Import from `@anvia/core` or `@anvia/core/embeddings`.

## EmbeddingModel and Embedding

```ts
type Embedding = {
  document: string;
  vector: number[];
};

interface EmbeddingModel {
  readonly dimensions?: number;
  readonly maxBatchSize?: number;
  embedTexts(texts: string[]): Promise<Embedding[]>;
}
```

Purpose: provider-neutral embedding contract.

Return behavior: `embedTexts(...)` must return one embedding per input text.

Notable errors: provider implementations may throw; helpers throw when the returned count does not match the input count.

## SparseEmbeddingModel and SparseEmbedding

```ts
type SparseVector = {
  indices: number[];
  values: number[];
};

type SparseEmbedding = {
  document: string;
  vector: SparseVector;
};

interface SparseEmbeddingModel {
  readonly maxBatchSize?: number;
  embedTexts(texts: string[]): Promise<SparseEmbedding[]>;
  embedQuery(query: string): Promise<SparseEmbedding>;
}
```

Purpose: sparse lexical/neural encoder contract for hybrid retrieval channels.

Return behavior: `embedTexts(...)` encodes passages for indexing; `embedQuery(...)` encodes
search queries and may use a different representation for models such as SPLADE.

Notable errors: helpers throw when returned sparse embedding counts do not match input length.

## EmbeddedDocument and Metadata

```ts
type VectorMetadataValue = string | number | boolean | null;
type VectorMetadata = Record<string, VectorMetadataValue>;

type EmbeddedDocument<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  document: T;
  metadata?: Metadata;
  embeddings: Embedding[];
  sparseEmbeddings?: SparseEmbedding[];
};
```

Purpose: document plus one or more embeddings for vector stores.

Return behavior: produced by `embedDocuments(...)` or `embedHybridDocuments(...)`. When sparse
vectors are present they must be aligned 1:1 with `embeddings` by chunk index.

Notable errors: none directly.

## EmbedDocumentsOptions

```ts
type EmbedDocumentsOptions<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id?: (document: T, index: number) => string;
  content(document: T, index: number): string | string[];
  metadata?: (document: T, index: number) => Metadata | undefined;
  concurrency?: number;
};

type EmbedHybridDocumentsOptions = {
  dense: EmbeddingModel;
  sparse: SparseEmbeddingModel;
};
```

Purpose: controls how typed documents become embedding inputs and metadata.

Return behavior: used by `embedDocuments(...)` and `embedHybridDocuments(...)`.

Notable errors: invalid content callbacks can throw and fail embedding.

## Embedding Helpers

```ts
function embedText(model: EmbeddingModel, text: string): Promise<Embedding>;
function embedTexts(model: EmbeddingModel, texts: string[]): Promise<Embedding[]>;
function embedSparseTexts(
  model: SparseEmbeddingModel,
  texts: string[],
): Promise<SparseEmbedding[]>;
function embedSparseQuery(
  model: SparseEmbeddingModel,
  query: string,
): Promise<SparseEmbedding>;
function embedDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  model: EmbeddingModel,
  documents: T[],
  options: EmbedDocumentsOptions<T, Metadata>,
): Promise<Array<EmbeddedDocument<T, Metadata>>>;
function embedHybridDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel },
  documents: T[],
  options: EmbedDocumentsOptions<T, Metadata>,
): Promise<Array<EmbeddedDocument<T, Metadata>>>;
```

Purpose: batch dense and sparse embedding helpers for typed documents.

Return behavior: `embedTexts([])` returns `[]`; `embedText(...)` returns the first embedding from a
single-item call; `embedHybridDocuments(...)` attaches aligned dense and sparse vectors for hybrid
stores such as Qdrant RRF search.

Notable errors: throws when the embedding model returns no embedding or a mismatched embedding count.

## Vector Math

```ts
function dotProduct(left: number[], right: number[]): number;
function cosineSimilarity(left: number[], right: number[]): number;
function angularDistance(left: number[], right: number[]): number;
function euclideanDistance(left: number[], right: number[]): number;
function manhattanDistance(left: number[], right: number[]): number;
function chebyshevDistance(left: number[], right: number[]): number;
```

Purpose: distance and similarity utilities for embedding vectors.

Return behavior: returns numeric scores or distances.

Notable errors: throws when vectors have different dimensions.

For workflow guidance, see [Embeddings](/docs/advanced/embeddings).
