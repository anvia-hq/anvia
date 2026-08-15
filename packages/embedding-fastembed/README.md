# @anvia/fastembed

Local dense and sparse embedding models for Anvia, powered by `fastembed`.

## Installation

```sh
pnpm add @anvia/fastembed @anvia/core fastembed
```

## Usage

```ts
import { embedDocuments, embedSparseQuery } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";
import {
  createFastEmbedEmbeddingModel,
  createFastEmbedSparseEmbeddingModel,
} from "@anvia/fastembed";

const model = await createFastEmbedEmbeddingModel();
const { documents } = await embedDocuments({
  model,
  documents: [{ id: "password-reset", text: "Reset links expire after 30 minutes." }],
  id: (document) => document.id,
  content: (document) => document.text,
});

const store = InMemoryVectorStore.fromDocuments({ documents });
const results = await retrieveDocuments({
  store,
  model,
  query: "How long does a reset link last?",
  topK: 3,
});

const sparse = await createFastEmbedSparseEmbeddingModel();
const { embedding } = await embedSparseQuery({
  model: sparse,
  query: "How long does a reset link last?",
});
```

The default dense model is `fast-bge-small-en-v1.5`; the default sparse model is
`prithivida/Splade_PP_en_v1`. Embedding helpers use object arguments, return named results, and
accept `retries` and `abortSignal`.

## Development

```sh
pnpm --filter @anvia/fastembed typecheck
pnpm --filter @anvia/fastembed test
pnpm --filter @anvia/fastembed build
```
