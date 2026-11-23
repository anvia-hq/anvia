# Running Evals

## Suite vs CLI

```ts
import {
  agentEvalTarget,
  assertEvalPassed,
  printEvalResult,
  runEvalCli,
  runEvalSuite,
} from "@anvia/core/evals";

// Library / Vitest use: inspect results or assert cleanly.
const result = await runEvalSuite({ name: "support-agent-target", cases, target, metrics });
printEvalResult(result);
assertEvalPassed(result);

// CLI/CI use: pretty summary, CLI flags (--case, --tag, --failed-only, --baseline, --save), exit code.
await runEvalCli({
  name: "support-basic-metrics",
  cases,
  target,
  metrics,
  expectations,
  argv: true,
  exitCode: true,
});
```

- `runEvalSuite` returns `passed`, `metricSummaries` (per-metric pass rate,
  mean/min/max score, mean duration), and full per-case results. It accepts
  `concurrency`, `caseTimeoutMs`, `failFast` (`EvalFailFastError` carries
  `caseResult` and `partialResults`), `caseIds` / `tags` / `caseFilter`, `shard`,
  `trials` (`pass@k` / `minPassRate`), `targetCache` (`createMemoryEvalCache` /
  `createFileEvalCache`), `signal`, `onProgress`, reporters, and `cost`/`targetUsage`.
- `runEvalCli` prints per-metric summaries and per-case details, optionally parses
  CLI flags (`argv: true` supports `--format`, `--case`, `--tag`, `--concurrency`,
  `--timeout`, `--trials`, `--shard`, `--fail-fast`, `--failed-only`, `--color`,
  `--progress`, `--baseline`, `--save`), asserts `expectations`, and with
  `exitCode: true` fails CI on regressions. Always set `exitCode: true` in CI.
- `assertEvalPassed(result, expectations?)` throws a detailed `EvalAssertionError`
  for test runners like Vitest.
- Use `saveEvalResult` / `loadEvalResult` + `compareEvalResults` (or
  `compareEvalTargets`) to catch regressions across prompt or model changes.

## Targets & Datasets

- Plain functions: `target: async (input) => answer(input)`.
- Agents: wrap with `agentEvalTarget(agent)` for string prompts, or
  `agentEvalTarget({ agent, request, interactions, output })` for custom inputs.
- Load JSON/JSONL datasets with `loadEvalCases(path, { autoId, schema })`.
- `defineEvalCases` / `defineEvalSuite` / `createEvalTypes` add type safety to
  large suites — adopt them when cases grow past a handful.

## Case design

- Every case needs `id`, `input`, `expected` (plus optional `tags` for slice runs).
  Keep ids stable — `expectations` and baseline diffs key off them.
- Include negative controls: inputs the target must get wrong (or must refuse),
  pinned as expected failures. Without them you cannot tell a strict metric
  from a broken target.
- For RAG cases add `context` (what the generator saw) and `retrievalContext`
  (what retrieval returned) so grounding metrics have something to check.
- Report evals to observability (Langfuse eval reporting, trace refs via
  `resolveEvalTraceRef`) when runs must be auditable — see the cookbook's
  langfuse eval-reporting example.
