---
"@anvia/durable": minor
---

Add `toolConcurrency` to `DurableAgentRegistration` so the tool calls of one model turn can run concurrently. It is validated, forwarded to every run of the agent, and reported by `compatibility()`.
