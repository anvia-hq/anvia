# @anvia/memory-prisma

Prisma-backed durable session memory store for Anvia agents.

Use this package when an application already uses Prisma and wants Anvia session memory to live in the same database and migration workflow.

## Installation

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/memory-prisma build
```

## Generate Prisma models

Run the init command from the application root:

```sh
npx @anvia/memory-prisma init
```

The command is a dry run by default. To write the generated Prisma model file:

```sh
npx @anvia/memory-prisma init --write
```

By default it writes `prisma/models/anvia-memory.prisma`. If you need to append to an existing `schema.prisma`, pass the explicit append flag:

```sh
npx @anvia/memory-prisma init --write --append-to-schema
```

The append path prints a warning before writing because it modifies the existing Prisma schema file.

After writing schema changes, run:

```sh
npx prisma validate
npx prisma migrate dev --name add_anvia_memory
```

## Usage

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

## Custom delegates

The default client path expects Prisma delegates named `agentMemorySession`, `agentMemoryMessage`, and `agentMemoryError`. If your app uses custom model names, pass delegates explicitly:

```ts
const memory = PrismaMemoryStore.fromDelegates({
  sessions: prisma.customMemorySession,
  messages: prisma.customMemoryMessage,
  errors: prisma.customMemoryError,
  transaction: (operation, options) =>
    prisma.$transaction(
      (tx) =>
        operation({
          sessions: tx.customMemorySession,
          messages: tx.customMemoryMessage,
          errors: tx.customMemoryError,
          transaction: async (nested) => nested({
            sessions: tx.customMemorySession,
            messages: tx.customMemoryMessage,
            errors: tx.customMemoryError,
            transaction: async () => {
              throw new Error("Nested transactions are not supported.");
            },
          }),
        }),
      options,
    ),
});
```

## Development

```sh
pnpm --filter @anvia/memory-prisma typecheck
pnpm --filter @anvia/memory-prisma test
pnpm --filter @anvia/memory-prisma build
```
