---
"@anvia/core": minor
---

Add an optional `promptRef?: { name; version? }` field on
`AgentRunStartArgs`. Observability adapters can use this to
record the prompt name and version on the trace root and on
each generation in the run.

The new field is optional, so existing call sites keep
compiling. The `AgentRunPromptRef` type is also exported
alongside.
