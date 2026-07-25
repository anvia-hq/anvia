---
"@anvia/mistral": patch
---

Fix Mistral tool-call handling: malformed tool-call JSON arguments now throw instead of being
silently coerced to a raw string, tool calls missing an id get a deterministic response-derived id
instead of a random UUID, tool result messages map the function name into the Mistral `name` field,
and `additionalParams` can no longer override the request `model` or `messages`.
