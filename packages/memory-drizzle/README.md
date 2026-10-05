# @anvia/memory-drizzle

Agent memory for applications using Drizzle and PostgreSQL. Store conversations alongside your application data, with schema and migrations under your control.

## Installation

```sh
pnpm add @anvia/memory-drizzle @anvia/core @anvia/openai drizzle-orm
```

## Quick start

Add the exported memory tables through your Drizzle migration workflow first; the [setup guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/memory-drizzle.md#generate-drizzle-schema-exports) includes the schema CLI. This example uses your existing Drizzle connection from `./db`.

```ts
import { Agent } from "@anvia/core";
import { DrizzleMemoryStore } from "@anvia/memory-drizzle";
import { OpenAIClient } from "@anvia/openai";
import { db } from "./db";

const store = new DrizzleMemoryStore({ db });
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

- Exported Drizzle tables and a schema scaffolding CLI.
- Durable conversations with optional tenant-scoped keys.
- Studio memory inspection and atomic compaction checkpoints.
- Application-owned connections and migrations.

The database must support transactions. The default advisory locking also requires `execute()`. The store never creates tables or closes your connection.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/memory-drizzle.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
