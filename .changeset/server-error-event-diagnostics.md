---
"@anvia/server": patch
---

Keep well-known diagnostic fields on JSONL and SSE error events. `code`,
`retryable`, and JSON-safe `details` are now copied explicitly because
runtime-specific Error subclasses (for example `bun:sqlite`'s `SqliteError`)
define them on the prototype, where `JSON.stringify` drops them, which also made
such payloads invalid under the client protocol. Non-JSON-safe thrown values
degrade to a `{ message }` payload instead of serializing as `{}`. `errorEvent`
is now exported publicly.
