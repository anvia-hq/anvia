# @anvia/fastembed

FastEmbed embedding model adapter for Anvia.

Use this package when you want local embedding generation through `fastembed`, especially for RAG workflows that should avoid remote embedding APIs.

## Installation

```sh
pnpm add @anvia/fastembed @anvia/core fastembed
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/fastembed build
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { createFastEmbedEmbeddingModel } from "@anvia/fastembed";

const embeddingModel = await createFastEmbedEmbeddingModel();

const documents = await embedDocuments(
  embeddingModel,
  [
    {
      id: "password-reset",
      title: "Password reset policy",
      body: "Password reset links expire after 30 minutes.",
    },
    {
      id: "priority-support",
      title: "Priority support",
      body: "Enterprise customers receive priority support.",
    },
  ],
  {
    id: (document) => document.id,
    content: (document) => `${document.title}\n${document.body}`,
  },
);

const store = InMemoryVectorStore.fromDocuments(documents);
const index = store.index(embeddingModel);

const results = await index.search({
  query: "How long does a password reset link last?",
  topK: 3,
});

console.log(results);
```

## Default Model

The default embedding model is:

```ts
fast-bge-small-en-v1.5
```

You can pass another FastEmbed model name:

```ts
const embeddingModel = await createFastEmbedEmbeddingModel({
  model: "fast-bge-base-en-v1.5",
  maxBatchSize: 32,
});
```

## Sparse embeddings (SPLADE++)

```ts
import { createFastEmbedSparseEmbeddingModel } from "@anvia/fastembed";

const sparse = await createFastEmbedSparseEmbeddingModel();
const [passage] = await sparse.embedTexts(["Password reset links expire after 30 minutes."]);
const query = await sparse.embedQuery("How long does a reset link last?");
```

The default sparse model is `prithivida/Splade_PP_en_v1`. Use it with dense embeddings and a
hybrid-capable store such as `@anvia/qdrant` (`hybrid: true` + RRF).

## Exports

- `FastEmbedEmbeddingModel`
- `createFastEmbedEmbeddingModel`
- `DEFAULT_FASTEMBED_EMBEDDING_MODEL`
- `FastEmbedEmbeddingModelName`
- `FastEmbedEmbeddingModelOptions`
- `FastEmbedRuntime`
- `FastEmbedSparseEmbeddingModel`
- `createFastEmbedSparseEmbeddingModel`
- `DEFAULT_FASTEMBED_SPARSE_EMBEDDING_MODEL`
- `FastEmbedSparseEmbeddingModelName`
- `FastEmbedSparseEmbeddingModelOptions`
- `FastEmbedSparseRuntime`

## Development

```sh
pnpm --filter @anvia/fastembed typecheck
pnpm --filter @anvia/fastembed test
pnpm --filter @anvia/fastembed build
```
