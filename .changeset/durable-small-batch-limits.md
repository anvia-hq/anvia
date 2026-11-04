---
"@anvia/server": patch
"@anvia/durable": patch
---

Warn when the durable HTTP body limit is below the payload limit, and send `Retry-After` on capacity
rejections.

- `@anvia/server`: `createDurableHandler` logs one warning at creation when `maxBodyBytes` is below
  the runtime's `maxPayloadBytes`. The default 64 KiB body limit is below the default 1 MiB payload
  limit, so the warning appears for default setups. It is advisory only: it never throws and the
  defaults are unchanged. The check is exported as `durableBodyLimitWarning` for tests and tooling.
  No warning is given when the runtime does not report its payload limit (older `@anvia/durable`).
- `@anvia/server`: capacity rejections (`code: "capacity_exceeded"`) return `429` with an integer
  `Retry-After: 1` header. This is a conservative hint, not a guarantee. Payload rejections (`413`)
  do not send it.
- `@anvia/durable`: add a read-only `runtime.limits()` that returns a copy of the effective limits
  after defaults. The server uses it for the startup check. This is additive, so it is a patch.
