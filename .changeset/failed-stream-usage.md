---
"@anvia/core": minor
"@anvia/openai": patch
"@anvia/langfuse": patch
"@anvia/otel": patch
"@anvia/studio": patch
---

Expose cumulative authoritative usage on failed agent stream events, include provider-reported usage
from failed OpenAI Responses requests, and retain failed child-agent usage in built-in observability
and Studio traces. Agent error event producers must now provide `usage`; unavailable provider usage
remains empty rather than estimated.
