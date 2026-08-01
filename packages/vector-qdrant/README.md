# `@anvia/qdrant`

Qdrant adapter for Anvia vector stores.

## Install

```bash
pnpm add @anvia/qdrant @anvia/core @qdrant/js-client-rest
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { QdrantVectorStore } from "@anvia/qdrant";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const embeddings = openai.embeddingModel("text-embedding-3-small");

const documents = await embedDocuments(
  embeddings,
  [{ id: "1", text: "Anvia is a TypeScript AI toolkit." }],
  {
    id: (document) => document.id,
    content: (document) => document.text,
  },
);

const store = await QdrantVectorStore.connect({
  collectionName: "docs",
  vectorSize: 1536,
});

await store.upsertDocuments(documents);

const results = await store.index(embeddings).search({
  query: "What is Anvia?",
  topK: 5,
});
```

## Hybrid search

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
  collectionName: "docs_hybrid",
  vectorSize: 384,
  hybrid: true,
});

await store.upsertDocuments(
  await embedHybridDocuments(
    { dense, sparse },
    [{ id: "1", text: "Anvia is a TypeScript AI toolkit." }],
    {
      id: (document) => document.id,
      content: (document) => document.text,
    },
  ),
);

const results = await store.index({ dense, sparse, fusion: "rrf" }).search({
  query: "What is Anvia?",
  topK: 5,
});
```
