# Running Evals

## Suite vs CLI

```ts
import { agentEvalTarget, runEvalCli, runEvalSuite } from "@anvia/core/evals";

// Library use: inspect results programmatically.
const result = await runEvalSuite({ name: "support-agent-target", cases, target, metrics });
console.log({
  passed: result.metrics.passed,
  failed: result.metrics.failed,
  invalid: result.metrics.invalid,
});

// CLI/CI use: pretty table, asserted expectations, process exit code.
await runEvalCli({
  name: "support-basic-metrics",
  cases,
  target,
  metrics,
  expectations,
  exitCode: true,
});
```

- `runEvalSuite` returns full per-case, per-metric results — use it in scripts
  and notebooks. It also takes execution controls for larger suites:
  `concurrency`, `caseTimeoutMs`, `failFast`, `caseIds`/`caseFilter`, `shard`,
  `signal`, `onProgress`, plus reporters and `cost`/`targetUsage` capture.
- `runEvalCli` prints tables (`printEvalResult` / `formatEvalResult` under the
  hood), asserts `expectations`, and with `exitCode: true` fails CI on
  regressions. Always set `exitCode: true` in CI. Output is tunable via
  `format: "pretty" | "json" | "quiet"`, `redact`, output writers, and
  `maxValueLength`.
- `expectations.outcomes` pins known outcomes per case — including intentional
  failures (negative controls), so a "fixed" negative control fails loudly
  instead of silently flipping green. `expectations.totals` pins aggregate
  counts per metric or for the whole run; `defineEvalExpectations`,
  `assertEvalTotals`, `assertEvalOutcomes`, and `evalExitCode` are the
  programmatic helpers behind the CLI.

## Targets

- Plain functions: `target: async (input) => answer(input)`.
- Agents: wrap with `agentEvalTarget({ agent, request: ({ input }) => ({ prompt: input }) })`
  and project `output.output` in metrics (see `references/metrics.md`).
- `defineEvalCases` / `defineEvalSuite` / `createEvalTypes` add type safety to
  large suites — adopt them when cases grow past a handful.

## Case design

- Every case needs `id`, `input`, `expected`. Keep ids stable — `expectations`
  and history key off them.
- Include negative controls: inputs the target must get wrong (or must refuse),
  pinned as expected failures. Without them you cannot tell a strict metric
  from a broken target.
- For RAG cases add `context` (what the generator saw) and `retrievalContext`
  (what retrieval returned) so grounding metrics have something to check.
- Report evals to observability (Langfuse eval reporting, trace refs via
  `resolveEvalTraceRef`) when runs must be auditable — see the cookbook's
  langfuse eval-reporting example.
