# @anvia/memory-sqlite guide

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

On Node.js the client uses the built-in `node:sqlite` driver. On Bun it loads `bun:sqlite`
automatically; the injected-database contract stays structural, so either driver (or a compatible
custom implementation) can be supplied through `{ database }`.

The store exposes Studio inspection and atomic compaction. `load()` and Studio inspection always
return the full canonical message history. Compaction stores one latest checkpoint in the session
row; `compaction.snapshot()` projects its tagged system summary plus the unsummarized tail for model
context. The adapter never chooses retention, calls a model, or retries mutations.

The session schema includes nullable `compaction_state_json`. `ensure()` adds the column to an
existing managed schema; `validate()` requires it without mutating application-owned schema.

Use `createSqliteMemorySchemaSql({ ... })` when schema SQL belongs in an application migration.

## Versioned and idempotent writes

The store implements the optional versioned, idempotent memory contract from `@anvia/core`:

```ts
const { messages, version } = await store.loadVersioned({ scope });

const result = await store.append({
  scope,
  runId: "run-1",
  turn: 0,
  messages: [message],
  idempotencyKey: "run-1:turn-0", // stable across retries of the same write
  expectedVersion: version, // reject the write if the history moved
});
// result.status is "committed", "duplicate" or "conflict"; result.version is the new version.
```

- A repeat of a committed key with the same `runId`, `turn` and `messages` is a `duplicate`. This
  is checked before the version, so a retry after success is not a conflict. The same key with
  different content, or a stale `expectedVersion`, is a `conflict`. Nothing is written in either
  case.
- The check and the insert run in one `BEGIN IMMEDIATE` transaction, so two writers that share an
  `expectedVersion` cannot both commit.
- The version is an opaque string. It changes on every committed append, on a `clear()` that
  removes data, and on a compaction `replacePrefix`.
- An empty `messages` array with a key still records the key.
- Without a key or `expectedVersion`, `append()` behaves as before. It now returns
  `{ status: "committed" }` instead of `undefined`.

Keys are scoped to the memory scope and survive `clear()`, so they live in their own table,
`anvia_memory_idempotency_keys` (`scope_key`, `idempotency_key`, `fingerprint`, `created_at`;
primary key on the first two). Override the name with `tableNames.idempotencyKeys` or
`tablePrefix`. `ensure()` and `createSqliteMemorySchemaSql()` create it. `validate()` does not
require it, so a database created before this table keeps working for plain load and append; a
keyed append against it throws an error that names the missing table. Run `ensure()` or add the
table to your migration to enable keys.
