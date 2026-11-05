---
"@anvia/client": patch
---

Surface the `message` of a durable error response when it has no `error` field.

- `DurableClient` already copied Anvia's `error` text and `Retry-After` into `DurableHttpError`. A
  rejection from a gateway or proxy that sends its text as `message` lost that text; it now keeps it.
- When both fields are present, `error` still wins.
