---
"@anvia/langfuse": minor
---

Add typed scores and per-score overrides to `tracing.score()`.

- New `dataType` field (`"NUMERIC" | "CATEGORICAL" | "BOOLEAN"`)
  with boundary validation. `value` is now `number | string` to
  support CATEGORICAL scores.
- New `configId` (canonical) and `scoreConfigId` (alias) fields for
  Langfuse score configs.
- New `environment` per-score override.
- New `timestamp` accepting `Date` or ISO 8601 string.
- New `timeoutMs` option on `LangfuseTracingOptions` (default 30 s),
  applied via `AbortSignal.timeout` to the score fetch.
