---
"@anvia/core": patch
---

Preserve error diagnostics in `toReadableStream` error lines. Well-known fields
such as `code` and `details` are now copied explicitly because runtime-specific
Error subclasses (for example `bun:sqlite`'s `SqliteError` under JavaScriptCore)
define them on the prototype, where `JSON.stringify` drops them. Thrown values
that are not JSON-safe no longer serialize as `{}` and degrade to a
`{ message }` payload instead.
