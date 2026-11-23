---
"@anvia/core": minor
"@anvia/otel": patch
"@anvia/lens": patch
"@anvia/langfuse": patch
---

Improve `@anvia/core/evals` developer experience and propagate new eval metadata across observability adapters:

- **Core (`@anvia/core`)**:
  - Fix core runner traps: attach `caseResult` and `partialResults` to `EvalFailFastError`, populate per-case `usage` and `cost` before `case-complete` progress events, and accept 3-argument `EvalTargetContext` targets in `defineEvalSuite`.
  - Add `passed`, per-metric `metricSummaries`, case `tags` filtering, multi-trial execution (`trials` / `pass@k` / `minPassRate`), and target caching (`createMemoryEvalCache`, `createFileEvalCache`, `cachedEvalTarget`).
  - Pass `trial`, `trialCount`, and `cached` to `EvalReportArgs`, and `passed` / `metricSummaries` to `EvalRunEndArgs`.
  - Simplify `agentEvalTarget(agent)` for string-prompt agents and add concise metric shorthands (`contains`, `notContains`, `containsAll`, `containsAny`, `matches`, `doesNotMatch`, `maxLength`, `requiredFields`), `caseSensitive`/`trim` options, `notBlank`, `schemaMatch`, `predicate`, and agent trajectory/budget metrics (`toolCalled`, `toolNotCalled`, `toolCallOrder`, `maxTurns`, `maxTokens`, `maxDurationMs`).
  - Improve LLM judge ergonomics with `createJudgeMetrics`, `includeReason: "on-fail"`, `llmJudge` auto-comment extraction and `BOOLEAN` projection, and model identity metadata for cost calculation.
  - Upgrade `runEvalCli` and `formatEvalResult` with `parseEvalCliArgs` / `argv` flag support, live stderr progress, per-metric summary output, `--failed-only`, optional ANSI colors, `assertEvalPassed`, baseline comparison (`compareEvalResults`, `compareEvalTargets`, `saveEvalResult`, `loadEvalResult`), and JSON/JSONL dataset loading (`loadEvalCases`).
- **OTEL & Lens (`@anvia/otel`, `@anvia/lens`)**:
  - Forward `case.tags`, `metric.model` (`provider`/`modelId`), `trial`, `trialCount`, `cached`, and `anvia.eval.run.passed` from `createOtelEvalReporter` (inherited by `LensClient.evalReporter`).
  - Parse optional `tags` on `LensDatasetItem` and align `LensDatasetItem.metadata` with `JsonObject` so `dataset.items` passes directly into `runEvalSuite`.
- **Langfuse (`@anvia/langfuse`)**:
  - Forward `caseTags`, `metricModel`, `trial`, `trialCount`, and `cached` into Langfuse score metadata.
  - Fix `runLangfuseEvalExperiment` to post only filtered/executed suite cases, resolve traces via `resolveEvalTraceRef` / `suite.trace`, preserve typed `Metrics`, and align `LangfuseDatasetItem.metadata` with `JsonObject`.
