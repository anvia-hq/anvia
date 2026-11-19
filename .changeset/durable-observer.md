---
"@anvia/durable": minor
---

Add `DurableObserver`, which reads runs (status, snapshot, event stream, result, list) from a process that does not own the database. It is backed by a new `DurableStore.connect()` that opens a store without a lease or migration and is read-only, enforced by SQLite `query_only` and Postgres read-only transactions. `DurableRun` now extends a read-only `DurableRunView`. Custom `DurableStore` implementations must add `connect()`.
