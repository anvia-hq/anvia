---
"@anvia/core": minor
---

Extend the `EvalMetric` type with optional Langfuse-related
annotations: `dataType`, `scoreConfigId`, `configId`, and
`metadata`. All fields are optional, so existing metric definitions
keep compiling unchanged.

Add a `defineMetric()` identity helper that wraps a metric
definition for clearer intent at call sites. Re-export it from
`@anvia/core/evals`.
