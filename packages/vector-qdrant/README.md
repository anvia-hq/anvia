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
  clientOptions: {
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY!,
  },
});

await store.upsertDocuments(documents);

const results = await store.index(embeddings).search({
  query: "What is Anvia?",
  topK: 5,
});
```

`upsertDocuments(...)` replaces every point previously stored for the same logical document IDs,
including stale points left when a document changes from multiple embeddings to fewer embeddings.
Mutations wait for Qdrant to apply them by default. You can override Qdrant's mutation controls when
needed. The official Qdrant client performs replacement as one ordered batch. Custom clients without
`batchUpdate(...)` fall back to sequential deletion and insertion; that fallback is not atomic, so a
failed insertion can leave the previous document removed. Require a `batchUpdate(...)`-capable
client to avoid this two-request failure window.

```ts
await store.upsertDocuments(documents, {
  wait: false,
  ordering: "strong",
  timeout: 30,
});
```

## Document management

Document operations use Anvia's logical document IDs. A deletion therefore removes every Qdrant
point created for a multi-embedding document.

```ts
await store.deleteDocuments(["1", "2"]);

const storedDocuments = await store.getDocuments(["1", "2"]);

const index = store.index(embeddings);
const firstPage = await index.inspect({ limit: 50 });
const nextPage = firstPage.nextCursor
  ? await index.inspect({ limit: 50, cursor: firstPage.nextCursor })
  : undefined;
```

For advanced Qdrant operations, construct and retain the native client instead of routing collection
administration through the Anvia adapter:

```ts
import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});
const store = await QdrantVectorStore.connect({
  client,
  collectionName: "docs",
  vectorSize: 1536,
});

await client.createPayloadIndex("docs", {
  field_name: "category",
  field_schema: "keyword",
  wait: true,
});
```

## Hybrid search

Also install a sparse embedding model. For local SPLADE++:

```bash
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
