---
"@anvia/durable": minor
---

Add shared worker mode: `DurableRuntime.open({ store, agents, worker: { workerId, leaseMs, heartbeatMs } })` lets several runtimes divide runs on one Postgres, Drizzle, or Prisma database. Workers claim runs, renew on a heartbeat, stop a run whose claim they lose, and fence every write for a run with its claim. The completion and failure writes no longer overwrite a run that was settled elsewhere. Agent runs only; tasks, graphs, and goals are rejected in worker mode. An owning runtime and shared workers cannot run together.
