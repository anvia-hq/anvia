---
"@anvia/otel": minor
"@anvia/lens": minor
"@anvia/langfuse": patch
---

Upgrade `@anvia/otel` and `@anvia/lens` to OpenTelemetry JS 3.x and fix OpenTelemetry peer dependency mismatches:

- `@anvia/otel`: drop `@opentelemetry/api-logs` and use the stable Logs API from `@opentelemetry/api@^1.10.0`.
- `@anvia/lens`: add `@opentelemetry/api@^1.10.0` as a direct dependency, upgrade `@opentelemetry/resources`, `@opentelemetry/sdk-logs`, and the OTLP HTTP exporters to the 3.x / `0.301.x` line, and replace the deprecated `@opentelemetry/sdk-trace-base` and `@opentelemetry/sdk-trace-node` packages with `@opentelemetry/sdk-trace`.
- `@anvia/langfuse`: cap `@opentelemetry/api` to `>=1.9.1 <1.10.0` and declare the OTel 2.x peers required by `@langfuse/otel@6.x` so all peer dependencies resolve cleanly.
