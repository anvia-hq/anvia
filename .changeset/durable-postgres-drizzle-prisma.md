---
"@anvia/durable": minor
"@anvia/core": patch
"@anvia/server": patch
---

Add Postgres, Drizzle and Prisma storage: `@anvia/durable/postgres` (`PostgresDurableStore` over a `pg` pool), `@anvia/durable/drizzle` and `@anvia/durable/prisma`, with user-owned schemas and the `anvia-durable-drizzle` / `anvia-durable-prisma` generators. `pg`, `drizzle-orm` and `@prisma/client` are optional peer dependencies. On Postgres one runtime owns the database through a lease row with a heartbeat; every transaction locks the owner row, so a stalled owner cannot commit after a takeover.

**Breaking:** the store interfaces are now async. `DurableStore`, `DurableTransaction` and `TaskTransaction` return promises, and `store.transaction(callback)` takes an async callback, serializes concurrent transactions and rejects nested ones. `DurableTransaction` replaces synchronous blob access with `tx.blobs(fn)`, and `putBlob`/`getBlob` are async. `TaskContext.spawn`, `spawnAgent`, `children`, `agentRun` and `signalValue` now return promises, and the `DurableRuntime` methods that read or write the store are async too: `run`, `status`, `snapshot`, `events`, `operationRequest`, `runScope`, `taskSubmissionScope`, `graphSnapshot`, `graphEvents`, `cancelGraph`, `steer`, `respond`, `resolveTool`, `resolveMemoryWrite`, `retry`, `cancel`, `metrics` and `unregisterAgent`. `SqliteDurableStore` keeps its behaviour and schema, but its methods (`acquire`, `close`, `transaction`, listings) are async. Custom stores and task definitions must await these calls.

Event streams now read the run status before its events, so a final event committed just before completion is never skipped.

`@anvia/core` and `@anvia/server`: the internal execution hooks `replayed` and `drainSteering` may return promises, and the durable HTTP handlers await the now-async `runScope` and `taskSubmissionScope`.
