# @anvia/memory-postgres

Postgres-backed durable session memory for Anvia agents.

```ts
import { Agent } from "@anvia/core";
import { PostgresMemoryClient } from "@anvia/memory-postgres";

await using postgres = new PostgresMemoryClient({
  connectionString: process.env.DATABASE_URL!,
});

const store = postgres.memoryStore({
  scopeKey: { metadataKeys: ["tenantId"] },
  lock: "advisory",
});

await store.validate();

const agent = new Agent({
  id: "support",
  model,
  memory: { store, savePolicy: "turn" },
});
```

Construction and `memoryStore()` perform no I/O. Call `ensure()` to create missing tables and
validate them, or `validate()` when application migrations own the schema. Ordinary memory and
compaction operations never provision resources.

`PostgresMemoryClient` closes pools it creates. A pool or client supplied with `{ client }` remains
caller-owned. The client also exposes `close()` and supports `await using`.

The store exposes Studio inspection and atomic compaction. `load()` and Studio inspection always
return the full canonical message history. Compaction stores one latest checkpoint in the session
row; `compaction.snapshot()` projects its tagged system summary plus the unsummarized tail for model
context. The adapter never chooses retention, calls a model, or retries mutations.

The session schema includes nullable `compaction_state`. `ensure()` adds the column to an existing
managed schema; `validate()` requires it without mutating application-owned schema.

Use `createPostgresMemorySchemaSql({ ... })` to include the default or customized schema in an
application migration.
