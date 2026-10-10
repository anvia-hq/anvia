---
"@anvia/core": minor
"@anvia/durable": minor
"@anvia/client": minor
"@anvia/server": minor
---

Add durable queued steering through `run.steer()`, `runtime.steer()`, and the HTTP client/handler. Steering accepts user prompts or messages, persists receipts and application boundaries, and optionally deduplicates delivery by request ID. Replay preserves saved requests and completed effects; pending approval and recovery decisions remain explicit, and steering respects the original turn budget.

Upgrade core and durable together for internal execution protocol 4. SQLite schemas 1–8 upgrade to schema 9; existing runs retain their original execution behavior, while newly submitted runs support steering. The HTTP packages require the matching durable release for steering protocol exports.
