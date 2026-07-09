# @anvia/memory-drizzle

Drizzle-backed durable session memory store for Anvia.

```ts
import { drizzleMemorySchema, createDrizzleMemoryStore } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
};

const memory = createDrizzleMemoryStore(db);
```

This adapter exports the table definitions so users can add the memory schema to
their Drizzle schema instead of copying table shapes by hand.
