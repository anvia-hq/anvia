---
"@anvia/langfuse": minor
---

Enrich the eval reporter with metadata, dataType propagation,
truncated input/expected summaries, and a configurable
`onMissingTrace` mode.

- Score body now includes `args.metric.metadata`, `dataType`,
  `configId`/`scoreConfigId` from `args.metric`. Categorical and
  boolean outcomes are sent with the correct `value` shape and
  dataType.
- `case.input` and `case.expected` are JSON-serialized and added as
  `caseInputSummary` / `caseExpectedSummary` in score metadata,
  truncated to `truncateInputAt` bytes (default 2048) with a
  `<truncated>` marker.
- `output.messages` is included by default; opt out with
  `includeMessages: false`.
- New `onMissingTrace` option (`"ignore" | "warn" | "throw"`)
  controls reporter behavior when no trace can be resolved. The
  legacy `strict: true` flag is now an alias for `"throw"`.
- Trace resolution now falls back to `args.case.input.trace` if
  `args.output.trace` is missing.
- The reporter does not mutate `args.metric.metadata`,
  `args.case.metadata`, or `args.outcome.metadata`.
