---
"@anvia/core": patch
"@anvia/otel": patch
"@anvia/lens": patch
---

Add constructor-level named Pipeline observability with run and stage lifecycles, primary trace
results, and automatic parent propagation into Agent stages. Add OpenTelemetry and Lens Pipeline
observers that export nested spans for composed, parallel, Agent, extraction, and custom stages.
