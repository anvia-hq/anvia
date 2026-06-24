---
"@anvia/langfuse": minor
---

Add PII redaction helpers. `createPiiRedactor` ships with default patterns for emails, credit cards (Luhn-validated), phones, IPv4 addresses, JWTs, and API keys, and supports `redactString`, `redactObject`, and `redactMessages`. Configure tracing with `redactInputs`, `redactOutputs`, and `redaction` to mask text before it leaves the process; `"deep"` recurses into nested values.
