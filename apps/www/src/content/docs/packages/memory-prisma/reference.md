---
title: "Memory Prisma"
description: "Public exports from @anvia/memory-prisma."
section: packages
sidebar:
  group: "memory-prisma"
  order: 6
  label: "Memory Prisma"
---
Import from `@anvia/memory-prisma`.

## createPrismaMemoryStore

```ts
function createPrismaMemoryStore(
  client: unknown,
  options?: PrismaMemoryStoreOptions,
): PrismaMemoryStore;
```

Purpose: create a Prisma-backed core `MemoryStore` from conventional Prisma Client delegates.

Return behavior: expects `agentMemorySession`, `agentMemoryMessage`, `agentMemoryError`, and `$transaction` on the provided client.

Notable errors: delegate errors reject through the calling session prompt. Stored malformed message JSON rejects during `load(...)` when `validateMessages` is enabled.

## PrismaMemoryStore

```ts
class PrismaMemoryStore {
  static fromClient(
    client: unknown,
    options?: PrismaMemoryStoreOptions,
  ): PrismaMemoryStore;

  static fromDelegates(
    delegates: PrismaMemoryDelegates,
    options?: PrismaMemoryStoreOptions,
  ): PrismaMemoryStore;

  load(context: PrismaMemoryContext): Promise<Message[]>;
  append(input: PrismaMemoryAppendInput): Promise<void>;
  clear(context: PrismaMemoryContext): Promise<void>;
  recordError(input: PrismaMemoryErrorInput): Promise<void>;
}
```

Purpose: implementation of the Anvia `MemoryStore` contract backed by Prisma models.

Return behavior: `append(...)` stores one ordered row per Anvia message, `load(...)` returns ordered messages, `clear(...)` deletes the scoped memory session, and `recordError(...)` stores failed-run diagnostics.

## createPrismaMemoryScopeKey

```ts
function createPrismaMemoryScopeKey(
  context: PrismaMemoryContext,
  options?: PrismaMemoryScopeOptions,
): string;
```

Purpose: convert `sessionId`, optional `userId`, and selected metadata keys into a stable database scope key.

Return behavior: returns a JSON string key. By default it includes `sessionId` and `userId`.

## PrismaMemoryStoreOptions

```ts
type PrismaMemoryErrorMode = "store" | "ignore";

type PrismaMemoryScopeOptions = {
  includeUserId?: boolean;
  metadataKeys?: string[];
};

type PrismaMemoryTransactionOptions = {
  isolationLevel?: string;
};

type PrismaMemoryStoreOptions = {
  scope?: PrismaMemoryScopeOptions | ((context: PrismaMemoryContext) => string);
  errors?: PrismaMemoryErrorMode;
  validateMessages?: boolean;
  transaction?: PrismaMemoryTransactionOptions;
};
```

Purpose: configure scope generation, failed-run storage, message validation, and transaction options.

Return behavior: defaults to `errors: "store"`, `validateMessages: true`, and a scope using `sessionId` plus `userId`.

## Delegate Types

```ts
type PrismaMemoryClientLike = PrismaMemoryConventionalDelegates & {
  $transaction<T>(
    operation: (tx: PrismaMemoryConventionalDelegates) => Promise<T>,
    options?: PrismaMemoryTransactionOptions,
  ): Promise<T>;
};

type PrismaMemoryDelegates = {
  sessions: PrismaMemorySessionDelegate;
  messages: PrismaMemoryMessageDelegate;
  errors?: PrismaMemoryErrorDelegate;
  transaction<T>(
    operation: (tx: PrismaMemoryDelegates) => Promise<T>,
    options?: PrismaMemoryTransactionOptions,
  ): Promise<T>;
};
```

Purpose: structural Prisma delegate contracts for conventional and custom Prisma model names.

Related exported data/input aliases: `PrismaMemoryAppendData`, `PrismaMemorySessionCreateData`, `PrismaMemoryErrorData`, `PrismaMemoryAppendInput`, `PrismaMemoryErrorInput`, and `PrismaMemoryContext`.

Related exported delegate aliases: `PrismaMemoryConventionalDelegates`, `PrismaMemorySessionDelegate`, `PrismaMemoryMessageDelegate`, and `PrismaMemoryErrorDelegate`.
