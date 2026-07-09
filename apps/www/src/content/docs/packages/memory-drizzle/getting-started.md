---
title: "@anvia/memory-drizzle: Getting Started"
description: "Install @anvia/memory-drizzle and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/memory-drizzle"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/memory-drizzle @anvia/core drizzle-orm
```

## Add the schema

```ts
import { drizzleMemorySchema } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
};
```

Include that schema in your Drizzle config and generate a migration with your normal Drizzle workflow.

## Configure memory

```ts
import { AgentBuilder } from "@anvia/core";
import { createDrizzleMemoryStore } from "@anvia/memory-drizzle";

const memory = createDrizzleMemoryStore(db);

const agent = new AgentBuilder("support", model)
  .memory(memory, { savePolicy: "turn" })
  .build();
```

Continue with [Usage Patterns](/docs/packages/memory-drizzle/usage-patterns).
