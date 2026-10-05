# @anvia/memory-prisma

Agent memory that lives in your Prisma database. Persist conversations across requests while keeping your existing client, schema, and migration workflow.

## Installation

```sh
pnpm add @anvia/memory-prisma @anvia/core @anvia/openai @prisma/client@7
```

## Quick start

The root entrypoint supports Prisma 7. Generate the memory models and migrate your database using the [setup guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/memory-prisma.md#generate-prisma-models). This example imports your configured Prisma client from `./db`.

```ts
import { Agent } from "@anvia/core";
import { PrismaMemoryStore } from "@anvia/memory-prisma";
import { OpenAIClient } from "@anvia/openai";
import { prisma } from "./db";

const store = new PrismaMemoryStore({ client: prisma });
await store.validate();

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new Agent({
  id: "support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  memory: { store, savePolicy: "turn" },
});

const result = await agent.generate({
  prompt: "Remember that my order number is 1234.",
  session: { sessionId: "support-123", userId: "user-456" },
});
if (result.type === "response") console.log(result.output);
```

## What you get

- Memory model scaffolding and custom delegate support.
- Persistent conversations with optional tenant-scoped keys.
- Studio memory inspection and compaction with compatible delegates.
- Application-owned clients and migrations.

Prisma 8 PostgreSQL integration uses the separate `@anvia/memory-prisma/v8` entrypoint and contract workflow described in the guide. The store never runs migrations or closes your Prisma client.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/memory-prisma.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
