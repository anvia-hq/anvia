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

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const embeddings = openai.embeddingModel({ modelId: "text-embedding-3-small" });
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

For shared collections, create tenant-scoped handles instead of generating one collection name per
user:

```ts
const tenant = qdrant.tenant(userId);
const store = tenant.vectorStore({ collectionName: "docs", dimensions: 1536 });
```

The tenant ID is deterministically hashed. The namespace is included in point identities and in
every replacement, search, hybrid search, inspection, lookup, and deletion filter. Different
tenant handles can therefore reuse one collection without colliding on logical document IDs.

Tenant handles scope Anvia's vector-store operations; they are not an authorization boundary for
code that can access the underlying Qdrant client or collection credentials.

## Hybrid usage

`mode: "hybrid"` returns a hybrid-capable store. Dense stores do not expose `searchHybrid()`.

```ts
import { embedDocuments, type SparseEmbeddingModel } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { QdrantVectorClient } from "@anvia/qdrant";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const dense = await loadTransformersEmbeddingModel({
  modelId: "Xenova/bge-small-en-v1.5",
});
declare const sparse: SparseEmbeddingModel; // Supply your sparse embedding implementation.
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
