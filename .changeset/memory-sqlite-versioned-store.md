---
"@anvia/memory-sqlite": minor
---

Implement the versioned, idempotent memory store contract. `loadVersioned()` returns the history with a version, and `append()` accepts `idempotencyKey` and `expectedVersion` and returns `committed`, `duplicate` or `conflict`. Keys are stored in a new `anvia_memory_idempotency_keys` table (configurable with `tableNames.idempotencyKeys`) that survives `clear()`; `ensure()` creates it. `append()` now returns `{ status: "committed" }` instead of `undefined`. Plain appends keep working on a database without the table, and a keyed append against one throws an error that names it.
