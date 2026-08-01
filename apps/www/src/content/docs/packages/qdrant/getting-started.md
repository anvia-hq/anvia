---
title: "@anvia/qdrant: Getting Started"
description: "Install @anvia/qdrant and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/qdrant"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/qdrant @anvia/core @qdrant/js-client-rest
```
## Minimum setup

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { QdrantVectorStore } from "@anvia/qdrant";

const openai = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const embeddings = openai.embeddingModel("text-embedding-3-small");

const documents = await embedDocuments(
  embeddings,
  [{ id: "password-reset", text: "Password reset links expire after 30 minutes." }],
  {
    id: (document) => document.id,
    content: (document) => document.text,
    metadata: () => ({ product: "support" }),
  },
);

const store = await QdrantVectorStore.connect({
  collectionName: "support_docs",
  vectorSize: 1536,
});

await store.upsertDocuments(documents);

const index = store.index(embeddings);
const results = await index.search({
  query: "How long does a reset link last?",
  topK: 3,
  filter: { product: "support" },
});

console.log(results);
```

## Hybrid search (dense + sparse RRF)

Also install `@anvia/fastembed` and `fastembed` when using local SPLADE++ sparse embeddings:

```sh
pnpm add @anvia/fastembed fastembed
```

```ts
import { embedHybridDocuments } from "@anvia/core/embeddings";
import {
  createFastEmbedEmbeddingModel,
  createFastEmbedSparseEmbeddingModel,
} from "@anvia/fastembed";
import { QdrantVectorStore } from "@anvia/qdrant";

const dense = await createFastEmbedEmbeddingModel();
const sparse = await createFastEmbedSparseEmbeddingModel();

const store = await QdrantVectorStore.connect({
  collectionName: "support_hybrid",
  vectorSize: 384,
  hybrid: true,
});

const documents = await embedHybridDocuments(
  { dense, sparse },
  [{ id: "password-reset", text: "Password reset links expire after 30 minutes." }],
  {
    id: (document) => document.id,
    content: (document) => document.text,
  },
);

await store.upsertDocuments(documents);

const results = await store.index({ dense, sparse, fusion: "rrf" }).search({
  query: "How long does a reset link last?",
  topK: 3,
});
```

Hybrid collections use named dense and sparse vectors. Dense-only collections stay on the
existing unnamed-vector path — create a new collection when enabling hybrid.
## Connection boundary

Create the store once during application startup or ingestion setup. The returned index should be passed to agents, tools, or retrieval helpers; database clients, collection names, credentials, and schema decisions should stay outside prompt construction.

## Next step

Continue with [Usage Patterns](/docs/packages/qdrant/usage-patterns).
