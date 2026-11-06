# @anvia/memory-postgres guide

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

## Versioned and idempotent appends

The store implements the optional versioned contract from `@anvia/core`:

- `loadVersioned({ scope })` returns the messages and an opaque `version`. The version changes on
  every committed append, on a `clear()` that removes data, and on a compaction `replacePrefix`.
  It is derived from the session row id, the highest message position and the compaction
  generation, so a cleared and recreated session never reuses an old version.
- `append()` accepts `idempotencyKey` and `expectedVersion` and returns `committed`, `duplicate`
  or `conflict` with the current `version`. A repeat of a committed key with the same content
  (run id, turn and messages) is a `duplicate`; the same key with different content, or a stale
  `expectedVersion`, is a `conflict`. Nothing is written for either. The duplicate check runs
  before the version check, and an empty `messages` array with a key still records the key.
- The check and insert run in one transaction under the session advisory lock; the key table's
  primary key is the backstop when `lock: "none"`.

Keys are stored in a separate `anvia_memory_idempotency_keys` table (`scope_key`,
`idempotency_key`, `fingerprint`; rename it with `tableNames.idempotencyKeys`). They are scoped to
the memory scope and survive `clear()`. `ensure()` creates the table. Applications that own their
schema must add it from `createPostgresMemorySchemaSql()`; until then plain `load()` and `append()`
keep working, and a keyed append throws an error that names the missing table.

Use `createPostgresMemorySchemaSql({ ... })` to include the default or customized schema in an
application migration.
