---
"@anvia/memory-drizzle": minor
---

Implement the versioned, idempotent memory store contract. `DrizzleMemoryStore` adds `loadVersioned()` and `append()` now accepts `idempotencyKey` and `expectedVersion` and returns a `MemoryAppendResult`. Idempotency keys live in a new `agent_memory_writes` table (`agentMemoryWrites`); regenerate the schema exports and run your Drizzle migrations to enable keyed appends. Plain `load()`, `append()` and `validate()` keep working without the new table.
