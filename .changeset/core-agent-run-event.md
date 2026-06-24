---
"@anvia/core": minor
---

Add an optional `event?` hook on `AgentRunObserver` so
observability adapters can record ad-hoc checkpoints (e.g.
retrieval, validation) during a run.

The new method accepts an `AgentRunEventArgs` value with a `name`,
optional `attributes` map, optional `level`, and optional
`timestamp`. The hook is optional, so existing adapters keep
working without modification.
