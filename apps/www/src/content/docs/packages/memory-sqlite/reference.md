---
title: "Memory SQLite"
description: "Public exports from @anvia/memory-sqlite."
section: packages
sidebar:
  group: "memory-sqlite"
  order: 6
  label: "Memory SQLite"
---
Import from `@anvia/memory-sqlite`.

## createSqliteMemoryStore

```ts
function createSqliteMemoryStore(options?: SqliteMemoryStoreOptions): SqliteMemoryStore;
```

Purpose: create a SQLite-backed core `MemoryStore`.

Return behavior: creates the memory tables by default when the database opens. The default path is `:memory:`.

## SqliteMemoryStore

```ts
class SqliteMemoryStore {
  load(context: SqliteMemoryContext): Promise<Message[]>;
  append(input: SqliteMemoryAppendInput): Promise<void>;
  clear(context: SqliteMemoryContext): Promise<void>;
  recordError(input: SqliteMemoryErrorInput): Promise<void>;
}
```

Purpose: implementation of the Anvia `MemoryStore` contract backed by SQLite tables.

Return behavior: `append(...)` stores one ordered row per message, `load(...)` returns ordered messages, `clear(...)` deletes the scoped memory session, and `recordError(...)` stores failed-run diagnostics.

## createSqliteMemoryScopeKey

```ts
function createSqliteMemoryScopeKey(
  context: SqliteMemoryContext,
  options?: SqliteMemoryScopeOptions,
): string;
```

Purpose: convert `sessionId`, optional `userId`, and selected metadata keys into a stable database scope key.

## SqliteMemoryStoreOptions

```ts
type SqliteMemoryErrorMode = "store" | "ignore";

type SqliteMemoryScopeOptions = {
  includeUserId?: boolean;
  metadataKeys?: string[];
};

type SqliteMemoryStoreOptions = {
  path?: string;
  scope?: SqliteMemoryScopeOptions | ((context: SqliteMemoryContext) => string);
  errors?: SqliteMemoryErrorMode;
  validateMessages?: boolean;
  createIfMissing?: boolean;
};
```

Purpose: configure the SQLite path, scope generation, failed-run storage, message validation, and table creation.

Related exported aliases: `SqliteMemoryAppendInput`, `SqliteMemoryContext`, `SqliteMemoryErrorInput`, `SqliteMemoryMessageRow`, and `SqliteMemorySessionRow`.
