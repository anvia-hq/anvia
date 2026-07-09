---
title: "@anvia/memory-sqlite: Examples"
description: "Small examples for SQLite-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-sqlite"
  order: 4
  label: "Examples"
---
## Basic memory store

```ts
import { createSqliteMemoryStore } from "@anvia/memory-sqlite";

export const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
});
```

## Test memory

```ts
const memory = createSqliteMemoryStore();
```

The default path is `:memory:`, so each store instance uses an in-memory SQLite database.

## Scoped agent

```ts
const agent = new AgentBuilder("support", model)
  .memory(
    createSqliteMemoryStore({
      path: "data/anvia-memory.sqlite",
      scope: { metadataKeys: ["tenantId"] },
    }),
    { savePolicy: "turn" },
  )
  .build();
```
