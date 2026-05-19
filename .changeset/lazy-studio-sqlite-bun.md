---
"@anvia/studio": patch
---

Lazy-load the default SQLite store so importing Studio does not require `node:sqlite` in Bun-compatible runtimes.
