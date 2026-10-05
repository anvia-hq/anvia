# @anvia/memory-postgres

Durable agent conversations in PostgreSQL. Keep session history in your own database and reuse it across requests and application restarts.

## Installation

```sh
pnpm add @anvia/memory-postgres @anvia/core @anvia/openai
```

## Quick start

Set `DATABASE_URL` and `OPENAI_API_KEY`. Start with an accessible PostgreSQL database.

```ts
import { Agent } from "@anvia/core";
import { PostgresMemoryClient } from "@anvia/memory-postgres";
import { OpenAIClient } from "@anvia/openai";

await using database = new PostgresMemoryClient({ connectionString: process.env.DATABASE_URL! });
const store = database.memoryStore();
await store.ensure();

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

- Persistent session history with optional tenant-scoped keys.
- Read-only memory inspection in Anvia Studio.
- Atomic compaction checkpoints while retaining canonical message history.
- Caller-owned pools or managed connections with explicit cleanup.

`ensure()` provisions missing tables; use `validate()` when application migrations own the schema. Reuse the same session identifiers to continue a conversation. Keep the client open for the lifetime of your application; `await using` closes owned resources at scope exit. Injected connections remain caller-owned.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/memory-postgres.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
