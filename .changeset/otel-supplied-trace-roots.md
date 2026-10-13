---
"@anvia/otel": minor
"@anvia/lens": patch
---

Fix durable runs staying "Running" in Lens. A run that supplied `trace.traceId` without `trace.parentObservationId`, as every `@anvia/durable` run does, started its root span under a placeholder parent span ID (`0000000000000001`) that was never exported, so backends that find roots by an empty parent never saw the run finish. Such runs now start a real root span in the supplied trace. Explicit parents and generated trace IDs are unchanged.

OpenTelemetry can only place a parentless span in a chosen trace through the provider's ID generator, so `@anvia/otel` adds `createAnviaIdGenerator()`. Pass it as the `idGenerator` of your tracer provider to keep runs that share a trace ID, such as durable run attempts, in one trace; other providers export those runs as roots of separate traces and log one diagnostic warning. `LensClient` installs it automatically.
