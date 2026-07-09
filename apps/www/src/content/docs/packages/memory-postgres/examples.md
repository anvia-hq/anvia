---
title: "@anvia/memory-postgres: Examples"
description: "Small examples for Postgres-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-postgres"
  order: 4
  label: "Examples"
---
## Basic memory store

```ts
import { createPostgresMemoryStore } from "@anvia/memory-postgres";

export const memory = await createPostgresMemoryStore({
  connectionString: process.env.DATABASE_URL,
});
```

## Migration-owned schema

```ts
const memory = await createPostgresMemoryStore({
  client: pool,
  createIfMissing: false,
});
```

## Scoped agent

```ts
const agent = new AgentBuilder("support", model)
  .memory(
    await createPostgresMemoryStore({
      client: pool,
      scope: { metadataKeys: ["tenantId"] },
    }),
    { savePolicy: "turn" },
  )
  .build();
```
