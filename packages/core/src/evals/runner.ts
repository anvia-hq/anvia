import { type Usage, Usage as UsageValue } from "../completion";
import { errorMessage } from "./format";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "./outcome";
import { defaultEvalTraceSelector } from "./reporting";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCostSummary,
  EvalMetric,
  EvalMetricResult,
  EvalReporter,
  EvalRunContext,
  EvalRunEndArgs,
  EvalRunStartArgs,
  EvalSuiteResult,
  EvalTotals,
  EvalTraceRef,
  RunEvalSuiteOptions,
} from "./types";

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
  const startedAtMs = Date.now();
  const run = resolveRun(options, startedAtMs);
  const reporters = options.reporters ?? [];
  const lifecycle = {
    run,
    suiteName: options.name,
    caseCount: options.cases.length,
    metricNames: options.metrics.map((metric) => metric.name),
  } satisfies EvalRunStartArgs;
  let reporterErrors: unknown[];
  try {
    reporterErrors = await notifyRunStart(
      reporters,
      lifecycle,
      options.failOnReporterError === true,
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
    results = await runEvalCases(options, run);
    aggregates = await aggregateResult(options, results);
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
    ...(aggregates.cost === undefined ? {} : { cost: aggregates.cost }),
    durationMs: Date.now() - startedAtMs,
    reporterErrors,
  };
  result.reporterErrors.push(
    ...(await notifyRunEnd(
      reporters,
      {
        ...lifecycle,
        status: "completed",
        completedAt,
        durationMs: result.durationMs,
        metrics: result.metrics,
        cases: result.cases,
        usage: result.usage,
        ...(result.cost === undefined ? {} : { cost: result.cost }),
      },
      options.failOnReporterError === true,
    )),
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
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 1));
  const results = new Array<EvalCaseResult<Input, Output, Expected, Metrics>>(options.cases.length);
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    while (failure === undefined && nextIndex < options.cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await runEvalCase(
          options,
          options.cases[index] as EvalCase<Input, Expected>,
          run,
        );
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, options.cases.length) }, () => worker()),
  );
  if (failure !== undefined) throw failure.error;
  return results;
}

async function runEvalCase<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  testCase: EvalCase<Input, Expected>,
  run: EvalRunContext,
): Promise<EvalCaseResult<Input, Output, Expected, Metrics>> {
  let output: Output | undefined;
  let targetError: unknown;
  try {
    output = await options.target(testCase.input, testCase);
  } catch (error) {
    targetError = error;
  }
  const traceResult = await resolveTrace(options, testCase, output, targetError);

  const metrics: EvalMetricResult[] = [];
  for (const metric of options.metrics) {
    const outcome =
      targetError === undefined
        ? await safeEvaluate(options.name, testCase, output as Output, metric)
        : EvalOutcome.invalid(`Target failed: ${errorMessage(targetError)}`);
    const reporterErrors = await reportOutcome({
      run,
      suiteName: options.name,
      testCase,
      output,
      targetError,
      metric,
      outcome,
      trace: traceResult.trace,
      traceError: traceResult.error,
      reporters: options.reporters ?? [],
      failOnReporterError: options.failOnReporterError === true,
    });
    const metricResult: EvalMetricResult = {
      metricName: metric.name,
      required: metric.required ?? true,
      outcome,
      reporterErrors,
    };
    if (metric.direction !== undefined) metricResult.direction = metric.direction;
    if (metric.threshold !== undefined) metricResult.threshold = metric.threshold;
    metrics.push(metricResult);
  }

  const scores = Object.fromEntries(
    metrics.map((metric) => [metric.metricName, metric.outcome]),
  ) as EvalCaseResult<Input, Output, Expected, Metrics>["scores"];
  const result: EvalCaseResult<Input, Output, Expected, Metrics> = {
    case: testCase,
    outcome: caseOutcome(targetError, metrics),
    metrics: metrics as EvalCaseResult<Input, Output, Expected, Metrics>["metrics"],
    scores,
  };
  if (output !== undefined) {
    result.output = output;
  }
  if (targetError !== undefined) {
    result.targetError = targetError;
  }
  return result;
}

async function resolveTrace<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
  output: Output | undefined,
  targetError: unknown,
): Promise<{ trace?: EvalTraceRef | undefined; error?: unknown }> {
  try {
    const selector = options.trace ?? defaultEvalTraceSelector;
    const trace = await selector({
      suiteName: options.name,
      case: testCase,
      output,
      targetError,
    });
    return trace === undefined ? {} : { trace };
  } catch (error) {
    return { error };
  }
}

async function safeEvaluate<Input, Output, Expected>(
  suiteName: string,
  testCase: EvalCase<Input, Expected>,
  output: Output,
  metric: EvalMetric<Input, Output, unknown, Expected>,
): Promise<EvalOutcomeType> {
  try {
    return await metric.evaluate({ suiteName, case: testCase, output });
  } catch (error) {
    return EvalOutcome.invalid(errorMessage(error));
  }
}

async function reportOutcome<Input, Output, Expected>(args: {
  run: EvalRunContext;
  suiteName: string;
  testCase: EvalCase<Input, Expected>;
  output: Output | undefined;
  targetError: unknown;
  metric: EvalMetric<Input, Output, unknown, Expected>;
  outcome: EvalOutcomeType;
  trace: EvalTraceRef | undefined;
  traceError: unknown;
  reporters: readonly EvalReporter<Input, Output, Expected>[];
  failOnReporterError: boolean;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (args.traceError !== undefined) {
    if (args.failOnReporterError) throw args.traceError;
    errors.push(args.traceError);
    return errors;
  }
  for (const reporter of args.reporters) {
    try {
      await reporter.report({
        run: args.run,
        suiteName: args.suiteName,
        case: args.testCase,
        output: args.output,
        targetError: args.targetError,
        trace: args.trace,
        metric: args.metric,
        outcome: args.outcome,
      });
    } catch (error) {
      if (args.failOnReporterError) {
        throw error;
      }
      errors.push(error);
    }
  }
  return errors;
}

function resolveRun<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  startedAtMs: number,
): EvalRunContext {
  const id = options.run?.id ?? globalThis.crypto.randomUUID();
  if (id.trim().length === 0 || id.length > 128) {
    throw new TypeError("Evaluation run id must contain 1 to 128 characters");
  }
  for (const [label, value] of [
    ["dataset name", options.run?.datasetName],
    ["dataset version", options.run?.datasetVersion],
  ] as const) {
    if (value !== undefined && (value.trim().length === 0 || value.length > 256)) {
      throw new TypeError(`Evaluation run ${label} must contain 1 to 256 characters`);
    }
  }
  return {
    id,
    startedAt: new Date(startedAtMs).toISOString(),
    ...(options.run?.datasetName === undefined ? {} : { datasetName: options.run.datasetName }),
    ...(options.run?.datasetVersion === undefined
      ? {}
      : { datasetVersion: options.run.datasetVersion }),
    ...(options.run?.metadata === undefined ? {} : { metadata: options.run.metadata }),
  };
}

async function notifyRunStart<Input, Output, Expected>(
  reporters: readonly EvalReporter<Input, Output, Expected>[],
  args: EvalRunStartArgs,
  failOnReporterError: boolean,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of reporters) {
    if (reporter.onRunStart === undefined) continue;
    try {
      await reporter.onRunStart(args);
    } catch (error) {
      if (failOnReporterError) throw error;
      errors.push(error);
    }
  }
  return errors;
}

async function notifyRunEnd<Input, Output, Expected>(
  reporters: readonly EvalReporter<Input, Output, Expected>[],
  args: EvalRunEndArgs,
  failOnReporterError = false,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of reporters) {
    if (reporter.onRunEnd === undefined) continue;
    try {
      await reporter.onRunEnd(args);
    } catch (error) {
      if (failOnReporterError) throw error;
      errors.push(error);
    }
  }
  return errors;
}

function countMetricOutcomes(
  results: Array<EvalCaseResult<unknown, unknown, unknown>>,
): EvalTotals {
  const totals = emptyTotals();
  for (const result of results) {
    for (const metric of result.metrics) {
      totals.total += 1;
      totals[statusKey(metric.outcome.outcome)] += 1;
    }
  }
  return totals;
}

function countCaseOutcomes(results: Array<EvalCaseResult<unknown, unknown, unknown>>): EvalTotals {
  const totals = emptyTotals();
  for (const result of results) {
    totals.total += 1;
    totals[statusKey(result.outcome)] += 1;
  }
  return totals;
}

function emptyTotals(): EvalTotals {
  return { total: 0, passed: 0, failed: 0, invalid: 0 };
}

function statusKey(status: "pass" | "fail" | "invalid"): "passed" | "failed" | "invalid" {
  if (status === "pass") return "passed";
  if (status === "fail") return "failed";
  return "invalid";
}

function caseOutcome(
  targetError: unknown,
  metrics: EvalMetricResult[],
): "pass" | "fail" | "invalid" {
  if (targetError !== undefined) return "invalid";
  const required = metrics.filter((metric) => metric.required);
  if (required.some((metric) => metric.outcome.outcome === "invalid")) return "invalid";
  if (required.some((metric) => metric.outcome.outcome === "fail")) return "fail";
  return "pass";
}

async function aggregateResult<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  results: Array<EvalCaseResult<Input, Output, Expected, Metrics>>,
): Promise<{
  metrics: EvalTotals;
  cases: EvalTotals;
  usage: { target: Usage; evaluation: Usage; total: Usage };
  cost?: EvalCostSummary | undefined;
}> {
  let targetUsage = UsageValue.empty();
  let evaluationUsage = UsageValue.empty();
  let targetCost = 0;
  let evaluationCost = 0;

  for (const result of results) {
    if (result.output !== undefined) {
      const usage = await resolveTargetUsage(options, result.case, result.output);
      if (usage !== undefined) {
        targetUsage = UsageValue.add(targetUsage, usage);
        if (options.cost !== undefined) {
          targetCost += await calculateCost(
            options.cost.calculate({
              kind: "target",
              suiteName: options.name,
              case: result.case,
              output: result.output,
              usage,
            }),
          );
        }
      }
    }
    for (const metricResult of result.metrics) {
      const usage = metricResult.outcome.usage;
      if (usage === undefined) continue;
      assertUsage(usage, `Evaluation usage for metric ${metricResult.metricName}`);
      evaluationUsage = UsageValue.add(evaluationUsage, usage);
      if (options.cost !== undefined && result.output !== undefined) {
        const metric = options.metrics.find(
          (candidate) => candidate.name === metricResult.metricName,
        );
        if (metric !== undefined) {
          evaluationCost += await calculateCost(
            options.cost.calculate({
              kind: "evaluation",
              suiteName: options.name,
              case: result.case,
              output: result.output,
              metric,
              usage,
            }),
          );
        }
      }
    }
  }

  const usage = {
    target: targetUsage,
    evaluation: evaluationUsage,
    total: UsageValue.add(targetUsage, evaluationUsage),
  };
  const aggregates: {
    metrics: EvalTotals;
    cases: EvalTotals;
    usage: typeof usage;
    cost?: EvalCostSummary | undefined;
  } = {
    metrics: countMetricOutcomes(results),
    cases: countCaseOutcomes(results),
    usage,
  };
  if (options.cost !== undefined) {
    aggregates.cost = {
      currency: options.cost.currency,
      target: targetCost,
      evaluation: evaluationCost,
      total: targetCost + evaluationCost,
    };
  }
  return aggregates;
}

async function resolveTargetUsage<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
  output: Output,
): Promise<Usage | undefined> {
  const usage =
    options.targetUsage === undefined
      ? usageFromOutput(output)
      : await options.targetUsage({ suiteName: options.name, case: testCase, output });
  if (usage !== undefined) assertUsage(usage, `Target usage for case ${testCase.id}`);
  return usage;
}

function usageFromOutput(output: unknown): Usage | undefined {
  if (typeof output !== "object" || output === null || !("usage" in output)) return undefined;
  return (output as { usage?: Usage | undefined }).usage;
}

function assertUsage(usage: Usage, label: string): void {
  for (const [key, value] of Object.entries(usage)) {
    if (key === "details") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`${label} must contain finite, non-negative token counts`);
    }
  }
}

async function calculateCost(value: number | Promise<number>): Promise<number> {
  const cost = await value;
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError("Evaluation cost calculator must return a finite, non-negative number");
  }
  return cost;
}

function validateSuiteOptions<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): void {
  assertUnique(
    options.cases.map((testCase) => testCase.id),
    "Evaluation case id",
  );
  assertUnique(
    options.metrics.map((metric) => metric.name),
    "Evaluation metric name",
  );
  if (options.cost !== undefined && options.cost.currency.trim().length === 0) {
    throw new TypeError("Evaluation cost currency must not be empty");
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${label} must be unique: ${value}`);
    seen.add(value);
  }
}
