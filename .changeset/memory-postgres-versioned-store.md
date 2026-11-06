---
"@anvia/memory-postgres": minor
---

Implement the versioned, idempotent memory store contract. `loadVersioned()` returns the history with a version, and `append()` accepts `idempotencyKey` and `expectedVersion` and returns `committed`, `duplicate` or `conflict`. Keys live in a new `anvia_memory_idempotency_keys` table created by `ensure()` and survive `clear()`. Plain `load()` and `append()` keep working on databases without the new table.
