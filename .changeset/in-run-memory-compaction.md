---
"@anvia/core": minor
"@anvia/durable": minor
---

Compact model-facing context during active tool loops and approval continuations. Preserve complete
parallel tool exchanges, the active user request, and canonical history. Add
`retention.recentToolTurns` (default one; zero allows summarizing the latest completed tool output).
Normal and streaming runs include summary usage and emit compaction progress.

Durable executions atomically checkpoint each model-call projection and its usage/events, including
skipped decisions. Recovery reuses committed projections and tools; uncommitted summaries use the
persisted retry budget. Existing submissions retain their original request sequence. SQLite schemas
1–5 upgrade to schema 6; upgrade core and durable together for execution protocol version 3.
