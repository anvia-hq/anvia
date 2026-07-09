---
title: "Memory Postgres"
description: "Public exports from @anvia/memory-postgres."
section: packages
sidebar:
  group: "memory-postgres"
  order: 6
  label: "Memory Postgres"
---
Import from `@anvia/memory-postgres`.

## createPostgresMemoryStore

```ts
async function createPostgresMemoryStore(
  options?: PostgresMemoryStoreOptions,
): Promise<PostgresMemoryStore>;
```

Purpose: create a Postgres-backed core `MemoryStore`.

Return behavior: creates tables by default, or uses existing tables when `createIfMissing: false` is set.

## PostgresMemoryStore

```ts
class PostgresMemoryStore {
  static connect(options?: PostgresMemoryStoreOptions): Promise<PostgresMemoryStore>;
  load(context: PostgresMemoryContext): Promise<Message[]>;
  append(input: PostgresMemoryAppendInput): Promise<void>;
  clear(context: PostgresMemoryContext): Promise<void>;
  recordError(input: PostgresMemoryErrorInput): Promise<void>;
}
```

Purpose: implementation of the Anvia `MemoryStore` contract backed by Postgres tables.

Return behavior: append and failed-run writes run inside a transaction and use advisory locking by default.

## createPostgresMemorySchemaSql

```ts
function createPostgresMemorySchemaSql(
  options?: PostgresMemorySchemaOptions,
): string;
```

Purpose: return SQL for the required Postgres tables and indexes.

## createPostgresMemoryScopeKey

```ts
function createPostgresMemoryScopeKey(
  context: PostgresMemoryContext,
  options?: PostgresMemoryScopeOptions,
): string;
```

Purpose: convert `sessionId`, optional `userId`, and selected metadata keys into a stable database scope key.

## Options And Client Types

```ts
type PostgresMemoryErrorMode = "store" | "ignore";
type PostgresMemoryLockMode = "advisory" | "none";

type PostgresMemoryTableNames = {
  sessions?: string;
  messages?: string;
  errors?: string;
};

type PostgresMemorySchemaOptions = {
  tablePrefix?: string;
  tableNames?: PostgresMemoryTableNames;
};

type PostgresMemoryStoreOptions = PostgresMemorySchemaOptions & {
  client?: PostgresMemoryClientLike;
  connectionString?: string;
  createIfMissing?: boolean;
  scope?: PostgresMemoryScopeOptions | ((context: PostgresMemoryContext) => string);
  errors?: PostgresMemoryErrorMode;
  validateMessages?: boolean;
  lock?: PostgresMemoryLockMode;
};
```

Purpose: configure connection, schema names, table creation, scope generation, failed-run storage, validation, and advisory locking.

Related exported aliases: `PostgresMemoryAppendInput`, `PostgresMemoryClientLike`, `PostgresMemoryContext`, `PostgresMemoryErrorInput`, `PostgresMemoryPoolLike`, `PostgresMemoryQueryResult`, `PostgresMemoryScopeOptions`, and `PostgresMemoryTransactionClientLike`.
