# @anvia/transformers

Transformers.js embedding model adapter for Anvia.

Use this package when you want local embedding generation through `@huggingface/transformers`, especially for development or lightweight RAG workflows.

## Installation

```sh
pnpm add @anvia/transformers @anvia/core @huggingface/transformers
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/transformers build
```

## Usage

```ts
import { embedDocuments, InMemoryVectorStore } from "@anvia/core";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

const embeddingModel = await createTransformersEmbeddingModel();

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
Xenova/all-MiniLM-L6-v2
```

You can pass another feature-extraction model:

```ts
const embeddingModel = await createTransformersEmbeddingModel({
  model: "Xenova/all-MiniLM-L6-v2",
  pooling: "mean",
  normalize: true,
  maxBatchSize: 16,
});
```

## Exports

- `TransformersEmbeddingModel`
- `createTransformersEmbeddingModel`
- `DEFAULT_TRANSFORMERS_EMBEDDING_MODEL`
- `TransformersEmbeddingModelOptions`
- `TransformersPooling`

## Development

```sh
pnpm --filter @anvia/transformers typecheck
pnpm --filter @anvia/transformers test
pnpm --filter @anvia/transformers build
```
