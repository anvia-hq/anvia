---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
"@anvia/cli": patch
---

Add durable goals that continue across bounded agent sessions with persisted handoffs,
application-verified completion, cumulative model-turn budgets, admission token/deadline limits,
stall detection, and explicit signal-based resumption. Preserve typed turn exhaustion and partial
messages, and expose capped owned-agent spawning and direct child run inspection.

SQLite journals upgrade to schema 7; older engines reject upgraded databases.
Allow the new durable minor line in client/server peer dependencies.
Document goal orchestration in the bundled durable skill.
