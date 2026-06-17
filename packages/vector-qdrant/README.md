# @anvia/qdrant

Qdrant vector store adapter for Anvia.

Use this package when you want to store Anvia embedded documents in Qdrant and query them through Anvia's vector search interfaces.

## Installation

```sh
pnpm add @anvia/qdrant @anvia/core @qdrant/js-client-rest
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/qdrant build
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { QdrantVectorStore } from "@anvia/qdrant";

const openai = new OpenAIClient({
  apiKey,
});

const embeddings = openai.embeddingModel("text-embedding-3-small");

const documents = await embedDocuments(
  embeddings,
  [
    {
      id: "password-reset",
      title: "Password reset policy",
      body: "Password reset links expire after 30 minutes.",
      product: "support",
    },
    {
      id: "priority-support",
      title: "Priority support",
      body: "Enterprise customers receive priority support.",
      product: "support",
    },
  ],
  {
    id: (document) => document.id,
    content: (document) => `${document.title}\n${document.body}`,
    metadata: (document) => ({
      product: document.product,
      title: document.title,
    }),
  },
);

const store = await QdrantVectorStore.connect({
  collectionName: "support_docs",
  vectorSize: 1536,
});

await store.upsertDocuments(documents);

const index = store.index(embeddings);
const results = await index.search({
  query: "How long does a password reset link last?",
  topK: 3,
});

console.log(results);
```

## Qdrant

By default, `QdrantVectorStore.connect` creates a `QdrantClient` from the `@qdrant/js-client-rest` package. You can also pass a custom client:

```ts
const store = await QdrantVectorStore.connect({
  client,
  collectionName: "support_docs",
  vectorSize: 1536,
  createIfMissing: true,
});
```

Qdrant requires collection dimensions before creating a collection, so `vectorSize` is required.

`connect(...)` is async by design. It verifies or creates the Qdrant collection before returning a store, so configuration and connection errors fail early instead of surfacing later from `upsertDocuments(...)` or `search(...)`. Constructors stay synchronous and side-effect free.

## Exports

- `QdrantVectorStore`
- `QdrantVectorIndex`
- `filterToQdrantFilter`
- `QdrantVectorStoreConnectOptions`

## Development

```sh
pnpm --filter @anvia/qdrant typecheck
pnpm --filter @anvia/qdrant test
pnpm --filter @anvia/qdrant build
```
