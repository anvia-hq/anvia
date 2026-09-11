---
"@anvia/langfuse": patch
---

Reject non-finite numeric score values (`NaN`, `Infinity`) in `LangfuseClient.score()` instead of serializing them as `null` in the score request body, matching the existing OpenTelemetry score validation.
