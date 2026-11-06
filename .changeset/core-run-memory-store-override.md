---
"@anvia/core": patch
---

Let an internal run option replace the memory store and session scope for one run. Durable uses it to record memory reads and writes. The option is internal; the public `Agent` API does not change.
