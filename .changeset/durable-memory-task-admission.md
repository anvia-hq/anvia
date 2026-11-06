---
"@anvia/durable": patch
---

Reject recorded memory agents in graph tasks and owned agent tasks at admission. They run under a synthetic session id, so the agent would read an empty history and write to a scope no caller names. `submitGraph()` throws a `TypeError` naming the agent, and `spawnAgent` fails the task with the same message. Submit the agent with `runtime.submit()` instead.
