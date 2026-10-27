# @anvia/jev

## 0.2.1

### Patch Changes

- 46e6f4f: Update upstream runtime dependencies to their latest releases, including `@anthropic-ai/sdk` and `@anthropic-ai/vertex-sdk` 1.x, `@mistralai/mistralai` 3.x and `@langfuse/otel` and `@langfuse/tracing` 6.x. The `zod` peer range is now `^4.6.7`. `@anvia/jev` adapts to `@typesafe-ai/sdk` 0.7, which no longer accepts a `null` state.

## 0.2.0

### Minor Changes

- aa4fb85: Add provider-neutral typed decisions through `@anvia/core/decision`: choice, multiple labels,
  rubric scores, boolean probabilities, validated execution, and ordered batches with retries
  and cancellation. Export the same operations and contracts from the Core root.

  Add `@anvia/jev` using TypeSafe's official SDK, including mixed questions, multi-label composition,
  normalized usage, raw responses, model listing, and injected clients. Score responses validate
  returned legends against the sent rubric criteria before normalization. Package guides document
  standalone application use and adapter contracts; external documentation should add the decision
  API and Jev package to the public catalog.
