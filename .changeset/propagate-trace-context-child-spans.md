---
"@anvia/otel": patch
"@anvia/langfuse": patch
---

Propagate trace-level correlation context (`trace.name`, `userId`, `sessionId`, `tags`, and `version`) onto child spans in agent, tool, and pipeline observers so observation/run-level queries and filtering work consistently across all spans in a trace.
