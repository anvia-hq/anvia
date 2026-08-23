---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/langfuse": patch
"@anvia/otel": patch
"@anvia/studio": patch
---

Replace Agent status results with explicit `response`, `interaction`, and `blocked` outcomes. Add
`Agent.resume()` and a stream handle exposing events, text deltas, final text and outcome promises,
steering, and cancellation. Flatten terminal Agent stream outcomes instead of wrapping them in a
`final` event, and migrate Studio, client adapters, and observability integrations to the new API.
