---
"@anvia/memory-prisma": minor
---

Implement core's versioned, idempotent memory store contract. `loadVersioned()` returns the history with a version, and `append()` accepts `idempotencyKey` and `expectedVersion` and returns `committed`, `duplicate` or `conflict`. Keys live in a new `AgentMemoryWrite` model (generated for Prisma 7 and Prisma 8) that survives `clear()`; add it and run a migration to use keyed appends. Plain load, append and `validate()` keep working on schemas without it, and a keyed append then throws an error naming the model.
