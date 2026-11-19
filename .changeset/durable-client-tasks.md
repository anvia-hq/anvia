---
"@anvia/durable": minor
---

`DurableClient` now submits and controls custom tasks: `submitTask(definition, ...)`, `submitRegisteredTask(...)`, `getTask`, `listTasks` and `taskGraph`, plus `signal`, `cancel`, `retry` and `resolveEffect` on the returned handle. A client-submitted task is stored `unadmitted`; the worker that claims it parses the input and builds the checkpoint, failing the task if the input is invalid. `TaskRecord` gains an optional `unadmitted` flag.
