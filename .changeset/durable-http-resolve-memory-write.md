---
"@anvia/server": minor
"@anvia/client": minor
---

Add `POST /durable/runs/:id/resolve-memory-write` to `createDurableHandler`, with body `{ operationKey, resolution: "applied" | "discarded" }`, and `DurableClient.resolveMemoryWrite()` plus `controller.resolveMemoryWrite()` on the durable chat transport. They settle a recorded memory write that blocked a run. The route returns 404 when the registered `@anvia/durable` predates `resolveMemoryWrite`, 409 when no matching blocked write exists, and uses the same authorization callback as the other mutations under the action `"resolve-memory-write"`.
