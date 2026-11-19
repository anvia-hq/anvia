---
"@anvia/durable": minor
---

Custom tasks and goals now work with shared workers: `DurableRuntime.open({ worker, tasks })` and `DurableWorker.start({ tasks })` claim tasks by definition name, renew their claims, resume a crashed worker's task from its checkpoint, and let any worker `signal`, `cancel`, `retry` or `resolveEffect`. Task-tree transactions take a per-tree lock, and timer waits are found by polling instead of in-process timers. `reconcileTree` takes a busy predicate in place of in-process sets. No schema change. `DurableClient` cannot submit tasks yet.
