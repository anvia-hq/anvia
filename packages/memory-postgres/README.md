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

The store exposes Studio inspection and atomic compaction. Compaction messages remain ordinary
ordered system messages; the adapter never chooses retention, calls a model, or retries mutations.

Use `createPostgresMemorySchemaSql({ ... })` to include the default or customized schema in an
application migration.
