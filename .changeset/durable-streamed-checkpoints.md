---
"@anvia/core": minor
"@anvia/durable": minor
---

Add opt-in durable agent streaming with persisted generation deltas, unique model-attempt identities, and validated streamed response checkpoints. Preserve completed model/tool results across retries and restarts, and support reconnecting through the existing event cursor APIs. Upgrade SQLite records to schema 4 and the core execution protocol to version 2.

Exclude observer failures from automatic model retries, commit streamed responses before local completion callbacks, and preserve primary stream errors when iterator cleanup also fails.
