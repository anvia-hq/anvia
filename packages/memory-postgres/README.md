# @anvia/memory-postgres

Postgres-backed durable session memory store for Anvia.

```ts
import { createPostgresMemoryStore } from "@anvia/memory-postgres";

const memory = await createPostgresMemoryStore({
  connectionString: process.env.DATABASE_URL,
});
```

The package creates the Anvia memory tables by default and writes ordered
messages transactionally. Pass `createIfMissing: false` when your own migrations
create the schema.

Its optional read-only memory inspector lets `@anvia/studio` discover existing conversations and
ordered message records directly from these tables.

The store exposes `compaction.snapshot({ scope })` and atomic
`compaction.replacePrefix({ ... })`. Compaction messages remain visible as ordinary ordered system
messages; this adapter never chooses retention, calls a model, or retries mutations.
