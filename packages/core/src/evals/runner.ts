import { runEvalCase, suiteAbortReason } from "./case-runner";
import { createConcurrencyLimiter } from "./execution";
import {
  aggregateResult,
  EvalFailFastError,
  EvalReporterDispatchError,
  notifyRunEnd,
  notifyRunStart,
  resolveRun,
  selectCases,
  validateSuiteOptions,
} from "./runner-summary";
import type {
  EvalCase,
  EvalCaseResult,
  EvalMetric,
  EvalRunContext,
  EvalRunEndArgs,
  EvalRunStartArgs,
  EvalSuiteResult,
  RunEvalSuiteOptions,
} from "./types";

export { EvalFailFastError, EvalReporterDispatchError };

export async function runEvalSuite<
  Input,
  Output,
  Expected = unknown,
  const Metrics extends readonly EvalMetric<
    NoInfer<Input>,
    NoInfer<Output>,
    unknown,
    NoInfer<Expected>,
    string
  >[] = readonly EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
): Promise<EvalSuiteResult<Input, Output, Expected, Metrics>>;
export async function runEvalSuite<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
): Promise<EvalSuiteResult<Input, Output, Expected, Metrics>> {
  validateSuiteOptions(options);
  const selectedCases = selectCases(options);
  const selectedOptions = {
    ...options,
    cases: selectedCases,
  } as unknown as RunEvalSuiteOptions<Input, Output, Expected, Metrics>;
  const startedAtMs = Date.now();
  const run = resolveRun(selectedOptions, startedAtMs);
  const reporters = options.reporters ?? [];
  const lifecycle = {
    run,
    suiteName: options.name,
    caseCount: selectedCases.length,
    metricNames: options.metrics.map((metric) => metric.name),
  } satisfies EvalRunStartArgs;
  let reporterErrors: unknown[];
  try {
    reporterErrors = await notifyRunStart(
      reporters,
      lifecycle,
      options.reporterErrorPolicy ?? "collect",
    );
  } catch (error) {
    await notifyRunEnd(reporters, {
      ...lifecycle,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error,
    });
    throw error;
  }
  let results: Array<EvalCaseResult<Input, Output, Expected, Metrics>>;
  let aggregates: Awaited<ReturnType<typeof aggregateResult>>;
  try {
    results = await runEvalCases(selectedOptions, run);
    aggregates = await aggregateResult(selectedOptions, results);
  } catch (error) {
    await notifyRunEnd(reporters, {
      ...lifecycle,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error,
    });
    throw error;
  }
  const completedAt = new Date().toISOString();
  const result: EvalSuiteResult<Input, Output, Expected, Metrics> = {
    name: options.name,
    run: { ...run, completedAt },
    results,
    metrics: aggregates.metrics,
    cases: aggregates.cases,
    usage: aggregates.usage,
    durationMs: Date.now() - startedAtMs,
    reporterErrors,
  };
  result.reporterErrors.push(
    ...results.flatMap((caseResult) =>
      caseResult.metrics.flatMap((metricResult) => metricResult.reporterErrors),
    ),
  );

  if (aggregates.cost !== undefined) {
    result.cost = aggregates.cost;
  }

  const runEndArgs: EvalRunEndArgs = {
    ...lifecycle,
    status: "completed",
    completedAt,
    durationMs: result.durationMs,
    metrics: result.metrics,
    cases: result.cases,
    usage: result.usage,
  };

  if (result.cost !== undefined) {
    runEndArgs.cost = result.cost;
  }

  result.reporterErrors.push(
    ...(await notifyRunEnd(reporters, runEndArgs, options.reporterErrorPolicy ?? "collect")),
  );
  return result;
}

async function runEvalCases<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  run: EvalRunContext,
): Promise<Array<EvalCaseResult<Input, Output, Expected, Metrics>>> {
  const targetConcurrency = options.targetConcurrency ?? options.concurrency ?? 1;
  const metricConcurrency = options.metricConcurrency ?? options.concurrency ?? 1;
  const workerConcurrency = Math.max(targetConcurrency, metricConcurrency);
  const targetLimit = createConcurrencyLimiter(targetConcurrency);
  const metricLimit = createConcurrencyLimiter(metricConcurrency);
  const results = Array<EvalCaseResult<Input, Output, Expected, Metrics>>(options.cases.length);
  let nextIndex = 0;
  let completedCases = 0;
  let failure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    while (failure === undefined && nextIndex < options.cases.length) {
      if (isAborted(options.signal)) {
        failure ??= { error: suiteAbortReason(options.signal) };
        break;
      }

      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await runEvalCase(
          options,
          options.cases[index] as EvalCase<Input, Expected>,
          run,
          targetLimit,
          metricLimit,
          () => completedCases,
        );
        completedCases += 1;

        if (isAborted(options.signal)) {
          failure ??= { error: suiteAbortReason(options.signal) };
        }

        if (options.failFast === true && results[index]?.outcome !== "pass") {
          const result = results[index];

          if (result !== undefined && result.outcome !== "pass") {
            failure ??= { error: new EvalFailFastError(result.case.id, result.outcome) };
          }
        }
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(workerConcurrency, options.cases.length) }, () => worker()),
  );

  if (failure !== undefined) throw failure.error;

  return results;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
