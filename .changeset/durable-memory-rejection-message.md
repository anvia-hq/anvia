---
"@anvia/durable": patch
---

Name the memory store contract in the `memory` rejection: the message now says memory needs a store with idempotent writes and conflict handling, which durable does not checkpoint, and points to durable sessions.
