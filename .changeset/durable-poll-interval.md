---
"@anvia/durable": minor
---

Add a `pollIntervalMs` runtime option that re-reads the store on an interval, so runs another process made eligible are scheduled and an active run cancelled by another writer is aborted. It is off by default and covers agent runs, not tasks or graphs.
