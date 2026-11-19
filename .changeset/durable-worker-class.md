---
"@anvia/durable": minor
---

Add `DurableWorker`: `await DurableWorker.start({ store, agents, workerId, leaseMs })` runs the executing half of a client/worker deployment, claiming only runs of the agents it registers and exposing no submit or control methods (those are `DurableClient`'s). In worker mode `unregisterAgent()` no longer refuses because of unfinished runs in the store, since another worker may execute them.
