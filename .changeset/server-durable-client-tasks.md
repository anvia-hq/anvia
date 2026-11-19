---
"@anvia/server": patch
---

With a store-only `DurableClient` as the durable handler's backend, task reads and controls are served; submitting a task over HTTP is refused with 503 and a clearer message, because authorizing it needs the task definitions.
