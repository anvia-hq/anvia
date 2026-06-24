---
"@anvia/langfuse": minor
---

Add env-var auto-init for tracing config and a `serviceName` option.

`langfuse.create()` now reads `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
`LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, and
`LANGFUSE_SERVICE_NAME` from the environment when the matching option
is not provided. Explicit options still win over env vars.

The new `serviceName` option is recorded on the root observation's
metadata and set as the OpenTelemetry `service.name` resource
attribute on the underlying `NodeSDK`.
