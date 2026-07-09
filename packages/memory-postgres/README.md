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
