import { type Usage, Usage as UsageValue } from "../completion";
import {
  abortable,
  type ConcurrencyLimiter,
  createConcurrencyLimiter,
  createEvalCaseSignal,
  EvalAbortError,
  EvalTimeoutError,
} from "./execution";
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
  EvalProgressEvent,
  RunEvalSuiteOptions,
} from "./types";

export class EvalReporterDispatchError extends AggregateError {
  readonly phase: string;

  constructor(phase: string, errors: readonly unknown[]) {
    super(errors, `Evaluation reporter ${phase} failed ${errors.length} time(s).`);
    this.name = "EvalReporterDispatchError";
    this.phase = phase;
  }
}

export class EvalFailFastError extends Error {
  constructor(
    readonly caseId: string,
    readonly outcome: "fail" | "invalid",
  ) {
    super(`Evaluation stopped after case ${caseId} produced a required ${outcome} outcome.`);
    this.name = "EvalFailFastError";
  }
}

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

async function runEvalCase<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  testCase: EvalCase<Input, Expected>,
  run: EvalRunContext,
  targetLimit: ConcurrencyLimiter,
  metricLimit: ConcurrencyLimiter,
  completedCases: () => number,
): Promise<EvalCaseResult<Input, Output, Expected, Metrics>> {
  const caseStartedAt = performance.now();
  const caseSignal = createEvalCaseSignal(options.signal, options.caseTimeoutMs);
  try {
    const progress = (event: EvalProgressEvent<Input, Output, Expected>) =>
      notifyProgress(options, event);
    await progress({
      type: "case-start",
      suiteName: options.name,
      case: testCase,
      completedCases: completedCases(),
      totalCases: options.cases.length,
    });
    let output: Output | undefined;
    let targetError: unknown;
    let targetStatus: "succeeded" | "failed" = "succeeded";
    let targetDurationMs = 0;
    try {
      output = await targetLimit(async () => {
        const targetStartedAt = performance.now();
        try {
          return await (caseSignal.signal.aborted
            ? Promise.reject(caseSignal.signal.reason)
            : abortable(
                caseSignal.signal,
                Promise.resolve(
                  options.target(testCase.input, testCase, { signal: caseSignal.signal }),
                ),
              ));
        } finally {
          targetDurationMs = performance.now() - targetStartedAt;
        }
      });
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw options.signal.reason ?? new EvalAbortError();
      }
      targetStatus = "failed";
      targetError = error;
    }
    await progress({
      type: "target-complete",
      suiteName: options.name,
      case: testCase,
      targetStatus,
      output,
      error: targetError,
      durationMs: targetDurationMs,
      completedCases: completedCases(),
      totalCases: options.cases.length,
    });
    const traceResult = await resolveTrace(options, testCase, output, targetError, targetStatus);

    const metrics = await Promise.all(
      options.metrics.map((metric) =>
        metricLimit(async () => {
          const metricStartedAt = performance.now();
          const outcome =
            targetStatus === "succeeded"
              ? await safeEvaluate(
                  options.name,
                  testCase,
                  output as Output,
                  metric,
                  caseSignal.signal,
                )
              : EvalOutcome.invalid(`Target failed: ${errorMessage(targetError)}`, {
                  kind: targetError instanceof EvalTimeoutError ? "timeout" : "target",
                  error: targetError,
                });
          const durationMs = performance.now() - metricStartedAt;
          const reporterErrors = await reportOutcome({
            run,
            suiteName: options.name,
            testCase,
            output,
            targetError,
            targetStatus,
            metric,
            outcome,
            trace: traceResult.trace,
            traceError: traceResult.error,
            reporters: options.reporters ?? [],
            reporterErrorPolicy: options.reporterErrorPolicy ?? "collect",
          });
          await progress({
            type: "metric-complete",
            suiteName: options.name,
            case: testCase,
            metricName: metric.name,
            outcome,
            durationMs,
            completedCases: completedCases(),
            totalCases: options.cases.length,
          });
          const metricResult: EvalMetricResult = {
            metricName: metric.name,
            required: metric.required ?? true,
            outcome,
            durationMs,
            reporterErrors,
          };
          if (metric.direction !== undefined) metricResult.direction = metric.direction;
          if (metric.threshold !== undefined) metricResult.threshold = metric.threshold;
          return metricResult;
        }),
      ),
    );

    const scores = Object.fromEntries(
      metrics.map((metric) => [metric.metricName, metric.outcome]),
    ) as EvalCaseResult<Input, Output, Expected, Metrics>["scores"];
    const result: EvalCaseResult<Input, Output, Expected, Metrics> = {
      case: testCase,
      outcome: caseOutcome(targetStatus, metrics),
      targetStatus,
      targetDurationMs,
      durationMs: performance.now() - caseStartedAt,
      metrics: metrics as EvalCaseResult<Input, Output, Expected, Metrics>["metrics"],
      scores,
      usage: emptyUsageSummary(),
    };
    if (targetStatus === "succeeded") {
      result.output = output;
    }
    if (targetStatus === "failed") {
      result.targetError = targetError;
    }
    await progress({
      type: "case-complete",
      suiteName: options.name,
      result,
      completedCases: completedCases() + 1,
      totalCases: options.cases.length,
    });
    return result;
  } finally {
    caseSignal.dispose();
  }
}

async function resolveTrace<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
  output: Output | undefined,
  targetError: unknown,
  targetStatus: "succeeded" | "failed",
): Promise<{ trace?: EvalTraceRef | undefined; error?: unknown }> {
  try {
    const selector = options.trace ?? defaultEvalTraceSelector;
    const trace = await selector({
      suiteName: options.name,
      case: testCase,
      output,
      targetError,
      targetStatus,
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
  signal: AbortSignal,
): Promise<EvalOutcomeType> {
  if (signal.aborted) {
    return EvalOutcome.fromError(
      signal.reason,
      signal.reason instanceof EvalTimeoutError ? "timeout" : "metric",
    );
  }
  try {
    return await abortable(
      signal,
      Promise.resolve(metric.evaluate({ suiteName, case: testCase, output, signal })),
    );
  } catch (error) {
    return EvalOutcome.fromError(error, error instanceof EvalTimeoutError ? "timeout" : "metric");
  }
}

async function reportOutcome<Input, Output, Expected>(args: {
  run: EvalRunContext;
  suiteName: string;
  testCase: EvalCase<Input, Expected>;
  output: Output | undefined;
  targetError: unknown;
  targetStatus: "succeeded" | "failed";
  metric: EvalMetric<Input, Output, unknown, Expected>;
  outcome: EvalOutcomeType;
  trace: EvalTraceRef | undefined;
  traceError: unknown;
  reporters: readonly EvalReporter<Input, Output, Expected>[];
  reporterErrorPolicy: "collect" | "throw";
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (args.traceError !== undefined) {
    errors.push(args.traceError);
  }
  for (const reporter of args.reporters) {
    try {
      await reporter.report({
        run: args.run,
        suiteName: args.suiteName,
        case: args.testCase,
        output: args.output,
        targetError: args.targetError,
        targetStatus: args.targetStatus,
        trace: args.trace,
        metric: args.metric,
        outcome: args.outcome,
      });
    } catch (error) {
      errors.push(error);
    }
  }
  throwReporterErrors("report", errors, args.reporterErrorPolicy);
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
  const run: EvalRunContext = {
    id,
    startedAt: new Date(startedAtMs).toISOString(),
  };
  if (options.run?.datasetName !== undefined) run.datasetName = options.run.datasetName;
  if (options.run?.datasetVersion !== undefined) run.datasetVersion = options.run.datasetVersion;
  if (options.run?.metadata !== undefined) run.metadata = options.run.metadata;
  return run;
}

async function notifyRunStart<Input, Output, Expected>(
  reporters: readonly EvalReporter<Input, Output, Expected>[],
  args: EvalRunStartArgs,
  errorPolicy: "collect" | "throw",
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of reporters) {
    if (reporter.onRunStart === undefined) continue;
    try {
      await reporter.onRunStart(args);
    } catch (error) {
      errors.push(error);
    }
  }
  throwReporterErrors("onRunStart", errors, errorPolicy);
  return errors;
}

async function notifyRunEnd<Input, Output, Expected>(
  reporters: readonly EvalReporter<Input, Output, Expected>[],
  args: EvalRunEndArgs,
  errorPolicy: "collect" | "throw" = "collect",
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of reporters) {
    if (reporter.onRunEnd === undefined) continue;
    try {
      await reporter.onRunEnd(args);
    } catch (error) {
      errors.push(error);
    }
  }
  throwReporterErrors("onRunEnd", errors, errorPolicy);
  return errors;
}

function throwReporterErrors(
  phase: string,
  errors: readonly unknown[],
  errorPolicy: "collect" | "throw",
): void {
  if (errorPolicy === "throw" && errors.length > 0) {
    throw new EvalReporterDispatchError(phase, errors);
  }
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

function emptyUsageSummary() {
  return {
    target: UsageValue.empty(),
    evaluation: UsageValue.empty(),
    total: UsageValue.empty(),
  };
}

function statusKey(status: "pass" | "fail" | "invalid"): "passed" | "failed" | "invalid" {
  if (status === "pass") return "passed";
  if (status === "fail") return "failed";
  return "invalid";
}

function caseOutcome(
  targetStatus: "succeeded" | "failed",
  metrics: EvalMetricResult[],
): "pass" | "fail" | "invalid" {
  if (targetStatus === "failed") return "invalid";
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
    let caseTargetUsage = UsageValue.empty();
    let caseEvaluationUsage = UsageValue.empty();
    let caseTargetCost = 0;
    let caseEvaluationCost = 0;
    if (result.targetStatus === "succeeded") {
      const usage = await resolveTargetUsage(options, result.case, result.output as Output);
      if (usage !== undefined) {
        caseTargetUsage = usage;
        targetUsage = UsageValue.add(targetUsage, usage);
        if (options.cost !== undefined) {
          caseTargetCost = await calculateCost(
            options.cost.calculate({
              kind: "target",
              suiteName: options.name,
              case: result.case,
              output: result.output as Output,
              usage,
            }),
          );
          targetCost += caseTargetCost;
        }
      }
    }
    for (const metricResult of result.metrics) {
      const usage = metricResult.outcome.usage;
      if (usage === undefined) continue;
      assertUsage(usage, `Evaluation usage for metric ${metricResult.metricName}`);
      caseEvaluationUsage = UsageValue.add(caseEvaluationUsage, usage);
      evaluationUsage = UsageValue.add(evaluationUsage, usage);
      if (options.cost !== undefined && result.targetStatus === "succeeded") {
        const metric = options.metrics.find(
          (candidate) => candidate.name === metricResult.metricName,
        );
        if (metric !== undefined) {
          const metricCost = await calculateCost(
            options.cost.calculate({
              kind: "evaluation",
              suiteName: options.name,
              case: result.case,
              output: result.output as Output,
              metric,
              usage,
            }),
          );
          metricResult.cost = metricCost;
          caseEvaluationCost += metricCost;
          evaluationCost += metricCost;
        }
      }
    }
    result.usage = {
      target: caseTargetUsage,
      evaluation: caseEvaluationUsage,
      total: UsageValue.add(caseTargetUsage, caseEvaluationUsage),
    };
    if (options.cost !== undefined) {
      result.cost = {
        currency: options.cost.currency,
        target: caseTargetCost,
        evaluation: caseEvaluationCost,
        total: caseTargetCost + caseEvaluationCost,
      };
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
      : await options.targetUsage({
          suiteName: options.name,
          case: testCase,
          output,
          signal: new AbortController().signal,
        });
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
  if (options.name.trim().length === 0) {
    throw new TypeError("Evaluation suite name must not be empty");
  }
  if (options.cases.length === 0) {
    throw new TypeError("Evaluation suite must contain at least one case");
  }
  if (options.metrics.length === 0) {
    throw new TypeError("Evaluation suite must contain at least one metric");
  }
  for (const testCase of options.cases) {
    if (testCase.id.trim().length === 0) {
      throw new TypeError("Evaluation case id must not be empty");
    }
  }
  for (const metric of options.metrics) {
    if (metric.name.trim().length === 0) {
      throw new TypeError("Evaluation metric name must not be empty");
    }
  }
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
  for (const [label, value] of [
    ["concurrency", options.concurrency],
    ["targetConcurrency", options.targetConcurrency],
    ["metricConcurrency", options.metricConcurrency],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Evaluation ${label} must be a positive integer`);
    }
  }
  if (
    options.caseTimeoutMs !== undefined &&
    (!Number.isSafeInteger(options.caseTimeoutMs) || options.caseTimeoutMs < 1)
  ) {
    throw new RangeError("Evaluation caseTimeoutMs must be a positive integer");
  }
  if (options.shard !== undefined) {
    if (!Number.isSafeInteger(options.shard.count) || options.shard.count < 1) {
      throw new RangeError("Evaluation shard count must be a positive integer");
    }
    if (
      !Number.isSafeInteger(options.shard.index) ||
      options.shard.index < 0 ||
      options.shard.index >= options.shard.count
    ) {
      throw new RangeError("Evaluation shard index must be between 0 and count - 1");
    }
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${label} must be unique: ${value}`);
    seen.add(value);
  }
}

function selectCases<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): readonly EvalCase<Input, Expected>[] {
  const requested = options.caseIds === undefined ? undefined : new Set(options.caseIds);
  if (requested !== undefined) {
    assertUnique([...options.caseIds!], "Evaluation selected case id");
    const available = new Set(options.cases.map((testCase) => testCase.id));
    for (const id of requested) {
      if (!available.has(id))
        throw new TypeError(`Evaluation selected case id was not found: ${id}`);
    }
  }
  const filtered = options.cases.filter(
    (testCase, index) =>
      (requested === undefined || requested.has(testCase.id)) &&
      (options.caseFilter === undefined || options.caseFilter(testCase, index)),
  );
  if (options.shard === undefined) return filtered;
  return filtered.filter((_, index) => index % options.shard!.count === options.shard!.index);
}

async function notifyProgress<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  event: EvalProgressEvent<Input, Output, Expected>,
): Promise<void> {
  await options.onProgress?.(event);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function suiteAbortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new EvalAbortError();
}
