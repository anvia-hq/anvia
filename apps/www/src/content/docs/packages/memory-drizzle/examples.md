---
title: "@anvia/memory-drizzle: Examples"
description: "Small examples for Drizzle-backed Anvia memory."
section: packages
sidebar:
  group: "@anvia/memory-drizzle"
  order: 4
  label: "Examples"
---
## Schema export

```ts
import { drizzleMemorySchema } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
  users,
  conversations,
};
```

## Basic memory store

```ts
import { createDrizzleMemoryStore } from "@anvia/memory-drizzle";

export const memory = createDrizzleMemoryStore(db);
```

## Scoped agent

```ts
const agent = new AgentBuilder("support", model)
  .memory(
    createDrizzleMemoryStore(db, {
      scope: { metadataKeys: ["tenantId"] },
    }),
    { savePolicy: "turn" },
  )
  .build();
```
