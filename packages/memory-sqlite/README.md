# @anvia/memory-sqlite

SQLite-backed durable session memory for Anvia agents.

```ts
import { Agent } from "@anvia/core";
import { SqliteMemoryClient } from "@anvia/memory-sqlite";

const sqlite = new SqliteMemoryClient({
  path: "data/anvia-memory.sqlite",
});

const store = sqlite.memoryStore({
  scopeKey: { metadataKeys: ["tenantId"] },
});

await store.ensure();

const agent = new Agent({
  id: "support",
  model,
  memory: { store, savePolicy: "turn" },
});

try {
  // Use the Agent across requests.
} finally {
  await sqlite.close();
}
```

Construction and `memoryStore()` perform no I/O. Call `ensure()` to create missing tables and
validate them, or `validate()` to require an existing compatible schema without provisioning.
Ordinary memory and compaction operations never create resources.

`SqliteMemoryClient` closes databases it creates. A database supplied with `{ database }` remains
caller-owned and must have SQLite foreign-key enforcement enabled; `ensure()` and `validate()`
reject incompatible injected connections. The client also supports `await using` through
`Symbol.asyncDispose`.

The store exposes Studio inspection and atomic compaction. Compaction messages remain ordinary
ordered system messages; the adapter never chooses retention, calls a model, or retries mutations.

Use `createSqliteMemorySchemaSql({ ... })` when schema SQL belongs in an application migration.
