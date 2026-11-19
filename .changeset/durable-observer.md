---
"@anvia/durable": minor
---

Add `DurableObserver`, which reads runs (status, snapshot, event stream, result, list) from a process that does not own the database. It is backed by a new `DurableStore.connect()` that opens a store without a lease or migration and is read-only, enforced by SQLite `query_only` and Postgres read-only transactions. `DurableRun` now extends a read-only `DurableRunView`. `new SqliteDurableStore(path, { readOnly: true })` opens the file read-only without creating anything, and is required to `connect()` a SQLite store; a writable SQLite store refuses it. Postgres, Drizzle and Prisma `connect()` also require an owner row that a runtime has initialised. Custom `DurableStore` implementations must add `connect()`.
