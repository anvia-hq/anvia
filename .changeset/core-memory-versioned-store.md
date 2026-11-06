---
"@anvia/core": minor
---

Add an optional versioned, idempotent memory store contract. `MemoryStore.loadVersioned()` returns the history with a version, and `append()` accepts `idempotencyKey` and `expectedVersion` and returns a `MemoryAppendResult` (`committed`, `duplicate` or `conflict`). Existing stores that return `void` from `append()` keep working. Adds `InMemoryMemoryStore`, a process-local reference implementation for tests and prototypes.
