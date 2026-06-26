---
title: Vector stores
description: Index, inspect, and query embedded knowledge.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 32
---

A vector store holds embedded documents and exposes a `VectorSearchIndex`. Agents do not need to know whether the index is in memory, Postgres, Qdrant, Chroma, or another adapter. They only need the search interface.

Core ships `InMemoryVectorStore` for local workflows, tests, demos, and small in-process indexes.

## Build An Index

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";

const embedded = await embedDocuments(embeddingModel, documents, {
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    source: document.source,
    product: document.product,
  }),
});

const store = InMemoryVectorStore.fromDocuments(embedded);
const index = store.index(embeddingModel);
```

Use the same embedding model for indexing and querying. If the query model returns a different vector dimension, the store rejects the search.

## Search

```ts
const results = await index.search({
  query: "How long does a password reset link last?",
  topK: 3,
  threshold: 0.72,
});

const best = results[0];
```

`search(...)` returns scored results sorted by descending score. Each result includes:

- `score`
- `id`
- original `document`
- optional `metadata`

Use `threshold` to drop weak matches before they enter the prompt.

The request and result contracts are exported as `VectorSearchRequest` and `VectorSearchResult`. A request contains `query`, `topK`, and optional `threshold` and `filter`. Use these types when writing adapters so application code can switch between `InMemoryVectorStore` and a production vector database without changing agent code.

## Search IDs

Use `searchIds(...)` when the vector store should only identify likely records and your application will load the full data elsewhere:

```ts
const matches = await index.searchIds({
  query: "enterprise support",
  topK: 5,
});

const articleIds = matches.map((match) => match.id);
const articles = await articleRepository.findMany(articleIds);
```

This pattern is useful when source records are large, sensitive, or should always be loaded through product data access code.

## Inspect The Index

Indexes can expose `inspect(...)` for Studio, admin tools, and debugging:

```ts
const page = await index.inspect?.({
  limit: 25,
  cursor: previousCursor,
});
```

Inspection returns stored documents and metadata, not embeddings. Use it to verify ingestion, source metadata, tenant filters, and pagination.

Not every production vector adapter has to support inspection. Build runtime code against `search(...)`; use `inspect(...)` as an optional admin capability.

Inspection types are exported as `VectorInspectRequest`, `VectorInspectItem`, and `VectorInspectPage`. Use them for Studio, admin UIs, and debugging endpoints, not for the main model path.

## Add Or Replace Documents

`InMemoryVectorStore.addDocuments(...)` adds new embedded documents and replaces existing ones with the same id:

```ts
const updated = await embedDocuments(embeddingModel, changedDocuments, {
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    source: document.source,
    updatedAt: document.updatedAt,
  }),
});

store.addDocuments(updated);
```

Keep ids stable across ingestion runs. Stable ids make updates predictable and prevent duplicate old chunks from remaining searchable.

## LSH Indexing

For larger in-memory prototypes, enable locality-sensitive hashing:

```ts
const store = InMemoryVectorStore.fromDocuments(embedded, {
  index: {
    type: "lsh",
    numTables: 8,
    numHyperplanes: 12,
    seed: 42,
  },
});
```

LSH narrows candidate documents before cosine scoring. It is useful for local experiments, but a production corpus should usually move to a real vector database adapter.

## Search As A Tool

Any `VectorSearchIndex` can be exposed as a tool:

```ts
import type { VectorSearchToolOptions } from "@anvia/core/vector-store";

const searchDocsOptions = {
  name: "search_support_docs",
  description: "Search support documentation for relevant policy and product facts.",
  topK: 4,
  threshold: 0.74,
} satisfies VectorSearchToolOptions;

const searchSupportDocs = index.asTool(searchDocsOptions);
```

Use a search tool when the model should decide whether retrieval is needed. Use `.dynamicContext(...)` when every request should receive retrieved context automatically.

`createVectorSearchTool(index, options)` is the standalone form behind `index.asTool(...)`. It creates a tool with `{ query, topK? }` input and returns scored vector search results. Keep the returned documents safe for model context, because the tool result is available to the agent.

## Adapter Boundary

Production adapters should implement `VectorSearchIndex<T, Metadata>`. The agent runtime only depends on:

- `search(...)`
- `searchIds(...)`
- `asTool(...)`
- optional `inspect(...)`

Keep provider clients, credentials, collection names, and upsert jobs outside the agent. Pass the prepared index into the agent factory or runner.

For local indexes, `IndexStrategy` is either `{ type: "bruteForce" }` or an LSH strategy. `InMemoryVectorIndex` is the concrete index returned by `store.index(model)`; most application code should depend on the `VectorSearchIndex` interface instead.
