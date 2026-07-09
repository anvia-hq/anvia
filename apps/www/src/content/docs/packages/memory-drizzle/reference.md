---
title: "Memory Drizzle"
description: "Public exports from @anvia/memory-drizzle."
section: packages
sidebar:
  group: "memory-drizzle"
  order: 6
  label: "Memory Drizzle"
---
Import from `@anvia/memory-drizzle`.

## Schema Exports

```ts
const agentMemorySessions: PgTable;
const agentMemoryMessages: PgTable;
const agentMemoryErrors: PgTable;

const drizzleMemorySchema = {
  agentMemorySessions,
  agentMemoryMessages,
  agentMemoryErrors,
};
```

Purpose: provide the Drizzle Postgres table definitions required by the memory store.

## createDrizzleMemoryStore

```ts
function createDrizzleMemoryStore(
  db: DrizzleMemoryDatabaseLike,
  options?: DrizzleMemoryStoreOptions,
): DrizzleMemoryStore;
```

Purpose: create a Drizzle-backed core `MemoryStore`.

Return behavior: uses the exported memory schema by default and writes through the provided Drizzle database.

## DrizzleMemoryStore

```ts
class DrizzleMemoryStore {
  load(context: DrizzleMemoryContext): Promise<Message[]>;
  append(input: DrizzleMemoryAppendInput): Promise<void>;
  clear(context: DrizzleMemoryContext): Promise<void>;
  recordError(input: DrizzleMemoryErrorInput): Promise<void>;
}
```

Purpose: implementation of the Anvia `MemoryStore` contract backed by Drizzle tables.

Return behavior: append and failed-run writes use the database transaction API when available and advisory locking by default.

## createDrizzleMemoryScopeKey

```ts
function createDrizzleMemoryScopeKey(
  context: DrizzleMemoryContext,
  options?: DrizzleMemoryScopeOptions,
): string;
```

Purpose: convert `sessionId`, optional `userId`, and selected metadata keys into a stable database scope key.

## DrizzleMemoryStoreOptions

```ts
type DrizzleMemoryErrorMode = "store" | "ignore";
type DrizzleMemoryLockMode = "advisory" | "none";
type DrizzleMemoryDatabaseLike = object;
type DrizzleMemorySchema = typeof drizzleMemorySchema;

type DrizzleMemoryScopeOptions = {
  includeUserId?: boolean;
  metadataKeys?: string[];
};

type DrizzleMemoryStoreOptions = {
  schema?: DrizzleMemorySchema;
  scope?: DrizzleMemoryScopeOptions | ((context: DrizzleMemoryContext) => string);
  errors?: DrizzleMemoryErrorMode;
  validateMessages?: boolean;
  lock?: DrizzleMemoryLockMode;
};
```

Purpose: configure schema tables, scope generation, failed-run storage, validation, and advisory locking.

Related exported aliases: `DrizzleMemoryAppendInput`, `DrizzleMemoryContext`, and `DrizzleMemoryErrorInput`.
