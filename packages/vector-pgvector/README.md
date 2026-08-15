# @anvia/pgvector

Postgres pgvector client and store adapter for Anvia.

## Installation

```sh
pnpm add @anvia/pgvector @anvia/core pg pgvector
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { PgVectorClient } from "@anvia/pgvector";

const embeddings = new OpenAIClient().embeddingModel("text-embedding-3-small");
const pgvector = new PgVectorClient({ connectionString: process.env.DATABASE_URL });
const store = pgvector.vectorStore<{ id: string; text: string }>({
  tableName: "support_docs",
  dimensions: 1536,
  metric: "cosine",
});

await store.ensure();

const { documents } = await embedDocuments({
  model: embeddings,
  documents: [{ id: "password-reset", text: "Reset links expire after 30 minutes." }],
  id: (document) => document.id,
  content: (document) => document.text,
});
await store.upsert({ documents });

const results = await retrieveDocuments({
  store,
  model: embeddings,
  query: "How long does a reset link last?",
  topK: 3,
});

await pgvector.close();
```

Constructing a client or store performs no I/O. `ensure()` creates or validates the extension and
table; `validate()` only validates existing resources. Search accepts raw vectors, while
`retrieveDocuments()` explicitly composes a store with an embedding model.

Pass `client` to `PgVectorClient` to inject a pool or compatible client. Injected clients remain
caller-owned and are not closed by `close()`.

## Development

```sh
pnpm --filter @anvia/pgvector typecheck
pnpm --filter @anvia/pgvector test
pnpm --filter @anvia/pgvector build
```
