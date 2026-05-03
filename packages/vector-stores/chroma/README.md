# @anvia/chroma

ChromaDB vector store adapter for Anvia.

Use this package when you want to store Anvia embedded documents in ChromaDB and query them through Anvia's vector search interfaces.

## Installation

```sh
pnpm add @anvia/chroma @anvia/core chromadb
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/chroma build
```

## Usage

```ts
import { embedDocuments } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { ChromaVectorStore } from "@anvia/chroma";

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

const store = await ChromaVectorStore.connect({
  collectionName: "support_docs",
});

await store.upsertDocuments(documents);

const index = store.index(embeddings);
const results = await index.search({
  query: "How long does a password reset link last?",
  topK: 3,
});

console.log(results);
```

## ChromaDB

By default, `ChromaVectorStore.connect` creates a `ChromaClient` from the `chromadb` package. You can also pass a custom client:

```ts
const store = await ChromaVectorStore.connect({
  client,
  collectionName: "support_docs",
  createIfMissing: true,
});
```

`connect(...)` is async by design. It verifies or creates the Chroma collection before returning a store, so configuration and connection errors fail early instead of surfacing later from `upsertDocuments(...)` or `search(...)`. Constructors stay synchronous and side-effect free.

## Exports

- `ChromaVectorStore`
- `ChromaVectorIndex`
- `filterToChromaWhere`
- `ChromaVectorStoreConnectOptions`

## Development

```sh
pnpm --filter @anvia/chroma typecheck
pnpm --filter @anvia/chroma test
pnpm --filter @anvia/chroma build
```
