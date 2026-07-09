---
title: "@anvia/memory-prisma: Getting Started"
description: "Install @anvia/memory-prisma and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/memory-prisma"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
```

## Generate the Prisma models

Run a dry run first:

```sh
npx @anvia/memory-prisma init
```

Write the generated model file:

```sh
npx @anvia/memory-prisma init --write
```

The default write path creates `prisma/models/anvia-memory.prisma`. If your project cannot use multi-file Prisma schemas, append explicitly:

```sh
npx @anvia/memory-prisma init --write --append-to-schema
```

The append path warns before writing because it modifies the existing `schema.prisma`.

After writing schema changes:

```sh
npx prisma validate
npx prisma migrate dev --name add_anvia_memory
```

## Configure memory

```ts
import { AgentBuilder } from "@anvia/core";
import { createPrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

const memory = createPrismaMemoryStore(prisma, {
  scope: {
    metadataKeys: ["tenantId"],
  },
});

const agent = new AgentBuilder("support", model)
  .memory(memory, { savePolicy: "turn" })
  .build();

await agent
  .session("thread_123", {
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  })
  .prompt("Where is my order?")
  .send();
```

`scope` defines the database key for one memory thread. The default key includes `sessionId` and `userId`; `metadataKeys: ["tenantId"]` adds `metadata.tenantId`, which isolates memory across tenants or workspaces.

## Next step

Continue with [Usage Patterns](/docs/packages/memory-prisma/usage-patterns).
