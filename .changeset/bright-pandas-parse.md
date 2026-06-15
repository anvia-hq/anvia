---
"@anvia/core": minor
---

Add direct completion helpers for non-streaming, streaming, and parsed structured output flows.

`createCompletion` now always returns a final completion result, `createCompletionStream` exposes raw normalized model stream events, and `createParsedCompletion` returns schema-validated data from direct completions.
