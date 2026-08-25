---
"@anvia/core": patch
"@anvia/langfuse": patch
"@anvia/lens": patch
"@anvia/logger": patch
"@anvia/otel": patch
"@anvia/studio": patch
---

Report cancelled Agent runs explicitly and gracefully drain active Studio runs before observability
providers shut down on SIGINT or SIGTERM.
