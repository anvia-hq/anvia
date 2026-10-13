---
"@anvia/durable": minor
"@anvia/core": patch
"@anvia/otel": patch
"@anvia/client": patch
"@anvia/server": patch
---

Trace durable runs cleanly in Lens and other observers. Every execution of a durable run (model retries, crash recovery, explicit retries, and resumed interactions) now shares one trace ID derived from the run ID. The trace is grouped under the submitted session, including task-owned, goal, and graph agent runs, and carries `durableRunId`/`durableEpoch` (plus task or graph IDs) in its metadata. `submit()`, `submitTask()`, `submitGoal()`, and `submitRegisteredTask()` accept an optional `trace` (`name`, `userId`, `tags`, `metadata`, `version`, up to 16 KiB).

Core's execution protocol gains an optional `replayed()` query. Model, tool, and context steps restored from a checkpoint no longer start observer spans or add to observer-reported usage, so a recovered run no longer shows phantom tool spans or duplicated token usage. `@anvia/otel` records `anvia.run.id` when a run starts, so failed or interrupted runs can still be correlated.

`@anvia/server`'s `createDurableHandler()` gains a `trace(request, resource)` option to set trace context for authorized submissions. HTTP clients cannot set `trace` themselves, so `@anvia/client` submission types omit it. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.11.
