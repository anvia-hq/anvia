---
title: "@anvia/memory-postgres: Getting Started"
description: "Install @anvia/memory-postgres and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/memory-postgres"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/memory-postgres @anvia/core pg
```

## Configure memory

```ts
import { AgentBuilder } from "@anvia/core";
import { createPostgresMemoryStore } from "@anvia/memory-postgres";

const memory = await createPostgresMemoryStore({
  connectionString: process.env.DATABASE_URL,
});

const agent = new AgentBuilder("support", model)
  .memory(memory, { savePolicy: "turn" })
  .build();
```

The adapter creates the required tables by default. Set `createIfMissing: false` when migrations own schema creation.

## Migration SQL

```ts
import { createPostgresMemorySchemaSql } from "@anvia/memory-postgres";

console.log(createPostgresMemorySchemaSql());
```

Continue with [Usage Patterns](/docs/packages/memory-postgres/usage-patterns).
