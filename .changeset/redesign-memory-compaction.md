---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/studio": patch
---

Replace message-count memory compaction thresholds with token-aware trigger and retention budgets.
Add a customizable token counter, token counts to compaction results and stream events, and
`Agent.compactMemory()` for explicit manual compaction.
