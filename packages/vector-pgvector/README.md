# @anvia/pgvector

Postgres pgvector store adapter for Anvia.

Use this package when you want to store Anvia embedded documents in Postgres with the pgvector extension and query them through Anvia's vector search interfaces.

## Installation

```sh
pnpm add @anvia/pgvector @anvia/core pg pgvector
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/pgvector build
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { PgVectorStore } from "@anvia/pgvector";

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

const store = await PgVectorStore.connect({
  tableName: "support_docs",
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

## Postgres

By default, `PgVectorStore.connect` creates a `pg.Pool` from `connectionString` or the normal Postgres environment variables supported by `pg`. You can also pass a custom `pg` client or pool:

```ts
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const store = await PgVectorStore.connect({
  client: pool,
  tableName: "support_docs",
  vectorSize: 1536,
  createIfMissing: true,
});
```

pgvector requires vector dimensions before creating a table, so `vectorSize` is required.

`connect(...)` is async by design. It verifies or creates the pgvector extension and backing table before returning a store, so configuration and connection errors fail early instead of surfacing later from `upsertDocuments(...)` or `search(...)`. Constructors stay synchronous and side-effect free.

## Exports

- `PgVectorStore`
- `PgVectorIndex`
- `filterToPgVectorWhere`
- `PgVectorStoreConnectOptions`

## Development

```sh
pnpm --filter @anvia/pgvector typecheck
pnpm --filter @anvia/pgvector test
pnpm --filter @anvia/pgvector build
```
