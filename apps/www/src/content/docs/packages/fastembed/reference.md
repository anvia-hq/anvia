---
title: "FastEmbed"
description: "Public exports from @anvia/fastembed."
section: packages
sidebar:
  group: "fastembed"
  order: 6
  label: "FastEmbed"
---
Import from `@anvia/fastembed`.

## DEFAULT_FASTEMBED_EMBEDDING_MODEL

```ts
const DEFAULT_FASTEMBED_EMBEDDING_MODEL = "fast-bge-small-en-v1.5";
```

Purpose: default FastEmbed model id used by `FastEmbedEmbeddingModel.create(...)`.

Return behavior: constant string.

Notable errors: none directly.

## FastEmbed Types

```ts
type FastEmbedEmbeddingModelName =
  | "fast-all-MiniLM-L6-v2"
  | "fast-bge-base-en"
  | "fast-bge-base-en-v1.5"
  | "fast-bge-small-en"
  | "fast-bge-small-en-v1.5"
  | "fast-bge-small-zh-v1.5"
  | "fast-multilingual-e5-large";

type FastEmbedRuntime = {
  embed(texts: string[], batchSize?: number): AsyncIterable<number[][]>;
};

type FastEmbedEmbeddingModelOptions = {
  model?: FastEmbedEmbeddingModelName;
  maxBatchSize?: number;
  initOptions?: {
    executionProviders?: ExecutionProvider[];
    maxLength?: number;
    cacheDir?: string;
    showDownloadProgress?: boolean;
    modelName?: string;
  };
};
```

Purpose: local FastEmbed model configuration and runtime contract.

Return behavior: consumed by the embedding model.

Notable errors: invalid runtime output causes embedding calls to throw.

## FastEmbedEmbeddingModel

```ts
class FastEmbedEmbeddingModel implements EmbeddingModel {
  readonly model: string;
  readonly maxBatchSize: number;
  constructor(runtime: FastEmbedRuntime, options?: FastEmbedEmbeddingModelOptions);
  static create(options?: FastEmbedEmbeddingModelOptions): Promise<FastEmbedEmbeddingModel>;
  embedTexts(texts: string[]): Promise<Embedding[]>;
}
```

Purpose: local FastEmbed adapter for Anvia embeddings.

Return behavior: `create(...)` initializes FastEmbed; `embedTexts(...)` returns one embedding per text.

Notable errors: rejects if model loading fails, runtime output shape is invalid, or the embedding count does not match input length.

## createFastEmbedEmbeddingModel

```ts
function createFastEmbedEmbeddingModel(
  options?: FastEmbedEmbeddingModelOptions,
): Promise<FastEmbedEmbeddingModel>;
```

Purpose: convenience wrapper around `FastEmbedEmbeddingModel.create(...)`.

Return behavior: resolves a ready embedding model.

Notable errors: same as `FastEmbedEmbeddingModel.create(...)`.

## DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL

```ts
const DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL = "prithivida/Splade_PP_en_v1";
```

Purpose: default FastEmbed sparse model id used by `FastEmbedSparseEmbeddingModel.create(...)`.

Return behavior: constant string.

Notable errors: none directly.

## FastEmbed Sparse Types

```ts
type FastEmbedSparseEmbeddingModelName = "prithivida/Splade_PP_en_v1";

type FastEmbedSparseRuntime = {
  passageEmbed(texts: string[], batchSize?: number): AsyncIterable<SparseVector[]>;
  queryEmbed(query: string): Promise<SparseVector>;
};

type FastEmbedSparseEmbeddingModelOptions = {
  model?: FastEmbedSparseEmbeddingModelName;
  maxBatchSize?: number;
  initOptions?: {
    executionProviders?: ExecutionProvider[];
    maxLength?: number;
    cacheDir?: string;
    showDownloadProgress?: boolean;
    modelName?: string;
  };
};
```

Purpose: local FastEmbed SPLADE++ sparse model configuration and runtime contract.

Return behavior: consumed by the sparse embedding model.

Notable errors: invalid runtime output causes embedding calls to throw.

## FastEmbedSparseEmbeddingModel

```ts
class FastEmbedSparseEmbeddingModel implements SparseEmbeddingModel {
  readonly model: string;
  readonly maxBatchSize: number;
  constructor(runtime: FastEmbedSparseRuntime, options?: FastEmbedSparseEmbeddingModelOptions);
  static create(
    options?: FastEmbedSparseEmbeddingModelOptions,
  ): Promise<FastEmbedSparseEmbeddingModel>;
  embedTexts(texts: string[]): Promise<SparseEmbedding[]>;
  embedQuery(query: string): Promise<SparseEmbedding>;
}
```

Purpose: local FastEmbed sparse adapter for hybrid retrieval with Anvia.

Return behavior: `create(...)` initializes FastEmbed `SparseTextEmbedding`; `embedTexts(...)`
uses passage encoding; `embedQuery(...)` uses query encoding.

Notable errors: rejects if model loading fails, runtime output shape is invalid, or the embedding
count does not match input length.

## createFastEmbedSparseEmbeddingModel

```ts
function createFastEmbedSparseEmbeddingModel(
  options?: FastEmbedSparseEmbeddingModelOptions,
): Promise<FastEmbedSparseEmbeddingModel>;
```

Purpose: convenience wrapper around `FastEmbedSparseEmbeddingModel.create(...)`.

Return behavior: resolves a ready sparse embedding model.

Notable errors: same as `FastEmbedSparseEmbeddingModel.create(...)`.
