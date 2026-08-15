# @anvia/qdrant

Qdrant vector client and dense/hybrid store adapter for Anvia.

## Installation

```sh
pnpm add @anvia/qdrant @anvia/core @qdrant/js-client-rest
```

## Dense usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { QdrantVectorClient } from "@anvia/qdrant";

const embeddings = new OpenAIClient().embeddingModel("text-embedding-3-small");
const qdrant = new QdrantVectorClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});
const store = qdrant.vectorStore<{ id: string; text: string }>({
  collectionName: "docs",
  dimensions: 1536,
  metric: "cosine",
});

await store.ensure();

const { documents } = await embedDocuments({
  model: embeddings,
  documents: [{ id: "1", text: "Anvia is a TypeScript AI toolkit." }],
  id: (document) => document.id,
  content: (document) => document.text,
});
await store.upsert({ documents, providerOptions: { wait: true } });

const results = await retrieveDocuments({
  store,
  model: embeddings,
  query: "What is Anvia?",
  topK: 5,
});

await qdrant.close();
```

Constructing a client or store performs no I/O. `ensure()` creates or validates the collection;
`validate()` only validates it. `upsert()` replaces all points previously stored for each incoming
document ID, preventing stale chunks. Raw `store.search()` accepts vectors and never embeds text.

## Hybrid usage

`mode: "hybrid"` returns a hybrid-capable store. Dense stores do not expose `searchHybrid()`.

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import {
  createFastEmbedEmbeddingModel,
  createFastEmbedSparseEmbeddingModel,
} from "@anvia/fastembed";
import { QdrantVectorClient } from "@anvia/qdrant";

const dense = await createFastEmbedEmbeddingModel();
const sparse = await createFastEmbedSparseEmbeddingModel();
const qdrant = new QdrantVectorClient({ url: process.env.QDRANT_URL });
const store = qdrant.vectorStore<{ id: string; text: string }>({
  collectionName: "docs_hybrid",
  dimensions: 384,
  mode: "hybrid",
});

await store.ensure();
const { documents } = await embedDocuments({
  models: { dense, sparse },
  documents: [{ id: "1", text: "Anvia is a TypeScript AI toolkit." }],
  id: (document) => document.id,
  content: (document) => document.text,
});
await store.upsert({ documents });

const results = await retrieveDocuments({
  store,
  models: { dense, sparse },
  fusion: "rrf",
  query: "What is Anvia?",
  topK: 5,
});
```

Pass `client` to `QdrantVectorClient` to inject the native SDK client. Injected clients remain
caller-owned.
