---
title: "@anvia/memory-sqlite: Getting Started"
description: "Install @anvia/memory-sqlite and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/memory-sqlite"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/memory-sqlite @anvia/core
```

## Configure memory

```ts
import { AgentBuilder } from "@anvia/core";
import { createSqliteMemoryStore } from "@anvia/memory-sqlite";

const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
});

const agent = new AgentBuilder("support", model)
  .memory(memory, { savePolicy: "turn" })
  .build();
```

By default the adapter creates the required tables when the database is first opened.

## Scope by tenant

```ts
const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
  scope: { metadataKeys: ["tenantId"] },
});
```

Continue with [Usage Patterns](/docs/packages/memory-sqlite/usage-patterns).
