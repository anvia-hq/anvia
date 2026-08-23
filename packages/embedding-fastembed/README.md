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
  loadFastEmbedEmbeddingModel,
  loadFastEmbedSparseEmbeddingModel,
} from "@anvia/fastembed";

const model = await loadFastEmbedEmbeddingModel({ modelId: "fast-bge-small-en-v1.5" });
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

const sparse = await loadFastEmbedSparseEmbeddingModel({ modelId: "prithivida/Splade_PP_en_v1" });
const { embedding } = await embedSparseQuery({
  model: sparse,
  query: "How long does a reset link last?",
});
```

FastEmbed loading is eager. FastEmbed 2.1 does not expose deterministic runtime disposal, so these
handles intentionally have no `close()` or `Symbol.asyncDispose`; their native resources are
garbage-collector managed. Reuse a loaded handle when you want runtime reuse.

Use `adaptFastEmbedEmbeddingModel({ runtime, modelId })` or
`adaptFastEmbedSparseEmbeddingModel({ runtime, modelId })` for caller-owned runtimes. Embedding
helpers use object arguments, return named results, and accept `retries` and `abortSignal`.

## Development

```sh
pnpm --filter @anvia/fastembed typecheck
pnpm --filter @anvia/fastembed test
pnpm --filter @anvia/fastembed build
```
