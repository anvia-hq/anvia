---
"@anvia/core": minor
"@anvia/jev": minor
---

Add provider-neutral typed decisions through `@anvia/core/decision`: choice, multiple labels,
rubric scores, boolean probabilities, validated execution, and ordered batches with retries
and cancellation. Export the same operations and contracts from the Core root.

Add `@anvia/jev` using TypeSafe's official SDK, including mixed questions, multi-label composition,
normalized usage, raw responses, model listing, and injected clients. Score responses validate
returned legends against the sent rubric criteria before normalization. Package guides document
standalone application use and adapter contracts; external documentation should add the decision
API and Jev package to the public catalog.
