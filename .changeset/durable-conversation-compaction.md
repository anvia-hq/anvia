---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Add opt-in conversation compaction on durable agent registrations. Summarize completed history
while retaining recent complete turns and preserving canonical messages. Persist summary
checkpoints, projected input, usage, and progress atomically for recovery, with bounded summary
attempts using the model retry policy.

SQLite schemas 1–5 upgrade to schema 6 when acquired. Use matching durable runtime and protocol
consumers; older engines reject the upgraded database. Compaction runs between session runs and inside active tool loops; graph tasks remain excluded.

Allow the durable 0.4 minor line in client and server peer compatibility ranges.
