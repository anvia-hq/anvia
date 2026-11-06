---
"@anvia/durable": minor
---

Add `run.resolveMemoryWrite(operationKey, "applied" | "discarded")` and `DurableRuntime.resolveMemoryWrite()`. A recorded memory write that blocked a run, because the store reported a conflict or its outcome is unknown, can now be settled by an operator. `"applied"` says the store already holds the messages, `"discarded"` drops them, and the run sends its remaining writes without a version check and completes. `retry()` still only sends the same write again.
