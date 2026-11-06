# @anvia/memory-drizzle guide

Drizzle-backed durable session memory store for Anvia.

Use this package when an application already uses Drizzle with PostgreSQL and wants Anvia session
memory to live in the same database and migration workflow.

## Installation

```sh
pnpm add @anvia/memory-drizzle @anvia/core drizzle-orm
```

## Generate Drizzle schema exports

Run the init command from the application root:

```sh
npx @anvia/memory-drizzle init
```

The command is a dry run by default. To write the generated schema export file:

```sh
npx @anvia/memory-drizzle init --write
```

The CLI resolves a schema file from a literal `schema` path in `drizzle.config.*`, then falls back
to `src/db/schema.ts`. By default it creates `anvia-memory.ts` beside that schema. Ensure the
generated file is included by the `schema` setting in your Drizzle config.

To add the exports directly to an existing schema file instead, pass the explicit append flag:

```sh
npx @anvia/memory-drizzle init --write --append-to-schema
```

The append path prints a warning before writing because it modifies the existing TypeScript file.
Use `--schema <path>` when the CLI cannot infer your schema location.

After writing schema changes, run your normal Drizzle migration workflow:

```sh
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Usage

```ts
import { DrizzleMemoryStore, drizzleMemorySchema } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
};

const memory = new DrizzleMemoryStore({
  db,
  schema: drizzleMemorySchema,
  scopeKey: { metadataKeys: ["tenantId"] },
});

await memory.validate();
```

This adapter exports the table definitions so users can add the memory schema to
their Drizzle schema instead of copying table shapes by hand.

The Drizzle database and its shutdown lifecycle remain caller-owned. `validate()` performs a
non-mutating read-path check; schema creation remains in the application's Drizzle migrations.
The database must support `transaction()` because writes and compaction are atomic. The default
`lock: "advisory"` mode also requires `execute()`; use `lock: "none"` only when the database
provides equivalent write serialization.

Its optional read-only memory inspector lets `@anvia/studio` discover existing conversations and
ordered message records directly from these tables.

The store exposes `compaction.snapshot({ scope })` and atomic
`compaction.replacePrefix({ ... })`. `load()` and inspection return the full canonical history;
the snapshot projects the session's latest checkpoint summary plus its unsummarized tail for model
context. The exported session table includes nullable `compactionState`; add the generated column
through the application's normal migration workflow. This adapter never chooses retention, calls a
model, or retries mutations.

## Versioned and idempotent appends

The store implements the optional versioned, idempotent contract from `@anvia/core`.

```ts
const { messages, version } = await memory.loadVersioned({ scope });
const result = await memory.append({
  scope,
  runId,
  turn,
  messages: produced,
  idempotencyKey: `${runId}:${turn}`,
  expectedVersion: version,
});
// result.status is "committed", "duplicate" or "conflict"; result.version is the current version.
```

- A repeat of a committed key with the same `runId`, `turn` and messages is a `duplicate`. The key
  is checked before the version, so a retry after success is not a conflict. The same key with
  different content, or a stale `expectedVersion`, is a `conflict`. Nothing is written for either.
- Keys are stored in the new `agent_memory_writes` table (`agentMemoryWrites`), unique per memory
  scope and key. They survive `clear()`.
- A version is an opaque string. It changes on every committed append, on a `clear()` that removes
  data, and on a compaction `replacePrefix()`.
- `append()` without a key or `expectedVersion` behaves as before.

### Migrating an existing install

The new table is additive. Existing installs keep working for plain `load()`, `append()` and
`validate()` without it, and a keyed append throws an error naming `agent_memory_writes` if the
table was not supplied in the `schema` option. To enable keys, regenerate the schema exports and
migrate:

```sh
npx @anvia/memory-drizzle init --write --force   # add --append-to-schema if you used it before
npx drizzle-kit generate
npx drizzle-kit migrate
```

If you pass `schema: drizzleMemorySchema` the new table is already included. `validate()` does not
check the writes table, so a missing migration surfaces on the first keyed append.

## Development

```sh
pnpm --filter @anvia/memory-drizzle typecheck
pnpm --filter @anvia/memory-drizzle test
pnpm --filter @anvia/memory-drizzle build
```
