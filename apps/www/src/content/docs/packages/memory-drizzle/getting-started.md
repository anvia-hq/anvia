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

Run the safe schema initializer from your application root:

```sh
npx @anvia/memory-drizzle init
npx @anvia/memory-drizzle init --write
```

The first command is a dry run. The second creates `anvia-memory.ts` beside the schema file resolved
from `drizzle.config.*`, or beside `src/db/schema.ts` by default. Ensure the generated file is
included by the `schema` setting in your Drizzle config.

To add the package exports directly to an existing schema file instead, use the explicit append
mode:

```sh
npx @anvia/memory-drizzle init --write --append-to-schema
```

Pass `--schema <path>` if your schema cannot be inferred. The CLI refuses to replace user-owned
files or existing generated blocks unless the safe `--force` path applies.

After writing the exports, generate and apply a migration through your normal Drizzle workflow:

```sh
npx drizzle-kit generate
npx drizzle-kit migrate
```

You can also add the exported schema to an existing TypeScript schema manually:

```ts
import { drizzleMemorySchema } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
};
```

Include that schema in your Drizzle config before generating a migration.

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
