import { Usage as UsageValue } from "../completion";
import { defaultEvalCacheKey, unwrapCachedEvalTarget } from "./cache";
import {
  abortable,
  type ConcurrencyLimiter,
  createEvalCaseSignal,
  EvalAbortError,
  EvalTimeoutError,
} from "./execution";
import { errorMessage } from "./format";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "./outcome";
import { defaultEvalTraceSelector } from "./reporting";
import {
  caseOutcome,
  computeCaseUsageAndCost,
  reportOutcome,
  resolveTrialConfig,
} from "./runner-summary";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCaseTrialRun,
  EvalCostSummary,
  EvalMetric,
  EvalMetricResult,
  EvalOutcomeStatus,
  EvalProgressEvent,
  EvalRunContext,
  EvalTargetCache,
  EvalTraceRef,
  EvalUsageSummary,
  RunEvalSuiteOptions,
} from "./types";

type SingleTrialExecution<Output> = {
  outcome: EvalOutcomeStatus;
  targetStatus: "succeeded" | "failed";
  output?: Output | undefined;
  targetError?: unknown;
  targetDurationMs: number;
  durationMs: number;
  cached?: boolean | undefined;
  metrics: EvalMetricResult[];
  usage: EvalUsageSummary;
  cost?: EvalCostSummary | undefined;
};

export async function runEvalCase<
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
  const { count: trialCount, minPassRate } = resolveTrialConfig(options.trials);
  const progress = (event: EvalProgressEvent<Input, Output, Expected>) =>
    options.onProgress?.(event);

  await progress({
    type: "case-start",
    suiteName: options.name,
    case: testCase,
    completedCases: completedCases(),
    totalCases: options.cases.length,
  });

  if (trialCount === 1) {
    const trial = await executeSingleTrial({
      options,
      testCase,
      run,
      trial: 1,
      trialCount: 1,
      targetLimit,
      metricLimit,
      completedCases,
      progress,
    });
    const result = buildCaseResult<Input, Output, Expected, Metrics>({
      testCase,
      outcome: trial.outcome,
      representative: trial,
      durationMs: performance.now() - caseStartedAt,
      targetDurationMs: trial.targetDurationMs,
      usage: trial.usage,
      cost: trial.cost,
    });
    await progress({
      type: "case-complete",
      suiteName: options.name,
      result,
      completedCases: completedCases() + 1,
      totalCases: options.cases.length,
    });
    return result;
  }

  const trialExecutions: Array<SingleTrialExecution<Output>> = [];
  for (let trialIndex = 1; trialIndex <= trialCount; trialIndex += 1) {
    if (options.signal?.aborted === true) {
      throw suiteAbortReason(options.signal);
    }

    const execution = await executeSingleTrial({
      options,
      testCase,
      run,
      trial: trialIndex,
      trialCount,
      targetLimit,
      metricLimit,
      completedCases,
      progress,
    });
    trialExecutions.push(execution);
  }

  const passed = trialExecutions.filter((entry) => entry.outcome === "pass").length;
  const failed = trialExecutions.filter((entry) => entry.outcome === "fail").length;
  const invalid = trialExecutions.filter((entry) => entry.outcome === "invalid").length;
  const passRate = passed / trialCount;
  const overallOutcome = resolveMultiTrialOutcome(passed, failed, invalid, trialCount, minPassRate);
  const representative = selectRepresentativeTrial(trialExecutions, overallOutcome);
  const aggregatedUsage = aggregateTrialUsage(trialExecutions);
  const aggregatedCost = aggregateTrialCost(trialExecutions);
  const totalTargetDurationMs = trialExecutions.reduce(
    (sum, entry) => sum + entry.targetDurationMs,
    0,
  );
  const runs: Array<EvalCaseTrialRun<Output>> = trialExecutions.map((entry, index) => {
    const trialRun: EvalCaseTrialRun<Output> = {
      trial: index + 1,
      outcome: entry.outcome,
      targetStatus: entry.targetStatus,
      targetDurationMs: entry.targetDurationMs,
      durationMs: entry.durationMs,
      metrics: entry.metrics,
    };

    if (entry.targetStatus === "succeeded") trialRun.output = entry.output;

    if (entry.targetStatus === "failed") trialRun.targetError = entry.targetError;

    if (entry.cached === true) trialRun.cached = true;

    return trialRun;
  });

  const result = buildCaseResult<Input, Output, Expected, Metrics>({
    testCase,
    outcome: overallOutcome,
    representative,
    durationMs: performance.now() - caseStartedAt,
    targetDurationMs: totalTargetDurationMs,
    usage: aggregatedUsage,
    cost: aggregatedCost,
  });
  result.trials = {
    count: trialCount,
    passed,
    failed,
    invalid,
    passRate,
    passAtK: passed > 0,
    passAllK: passed === trialCount,
    minPassRate,
    runs,
  };

  await progress({
    type: "case-complete",
    suiteName: options.name,
    result,
    completedCases: completedCases() + 1,
    totalCases: options.cases.length,
  });
  return result;
}

async function executeSingleTrial<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(args: {
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>;
  testCase: EvalCase<Input, Expected>;
  run: EvalRunContext;
  trial: number;
  trialCount: number;
  targetLimit: ConcurrencyLimiter;
  metricLimit: ConcurrencyLimiter;
  completedCases: () => number;
  progress: (event: EvalProgressEvent<Input, Output, Expected>) => void | Promise<void>;
}): Promise<SingleTrialExecution<Output>> {
  const {
    options,
    testCase,
    run,
    trial,
    trialCount,
    targetLimit,
    metricLimit,
    completedCases,
    progress,
  } = args;
  const trialStartedAt = performance.now();
  const caseSignal = createEvalCaseSignal(options.signal, options.caseTimeoutMs);
  try {
    let output: Output | undefined;
    let targetError: unknown;
    let targetStatus: "succeeded" | "failed" = "succeeded";
    let targetDurationMs = 0;
    let cached = false;

    const unwrapped =
      options.targetCache === undefined ? unwrapCachedEvalTarget(options.target) : undefined;
    const effectiveTarget = unwrapped?.target ?? options.target;
    const cache = (options.targetCache ?? unwrapped?.cache) as
      | EvalTargetCache<Input, Output, Expected>
      | undefined;
    let cacheKey: string | undefined;

    if (cache !== undefined) {
      cacheKey = cache.keyFor
        ? cache.keyFor(testCase, trial)
        : defaultEvalCacheKey(testCase, trial);
    }

    if (cache !== undefined && cacheKey !== undefined) {
      try {
        const hit = await abortable(
          caseSignal.signal,
          Promise.resolve(cache.get(cacheKey, testCase)),
        );

        if (hit !== undefined) {
          output = hit.output;
          targetDurationMs = hit.targetDurationMs ?? 0;
          cached = true;
        }
      } catch (error) {
        if (options.signal?.aborted === true) {
          throw suiteAbortReason(options.signal);
        }

        if (caseSignal.signal.aborted) {
          targetStatus = "failed";
          targetError = error;
        }
      }
    }

    if (!cached && targetStatus === "succeeded") {
      try {
        output = await targetLimit(async () => {
          const targetStartedAt = performance.now();
          try {
            return await (caseSignal.signal.aborted
              ? Promise.reject(caseSignal.signal.reason)
              : abortable(
                  caseSignal.signal,
                  Promise.resolve(
                    effectiveTarget(testCase.input, testCase, {
                      signal: caseSignal.signal,
                      trial,
                    }),
                  ),
                ));
          } finally {
            targetDurationMs = performance.now() - targetStartedAt;
          }
        });
      } catch (error) {
        if (options.signal?.aborted === true) {
          throw suiteAbortReason(options.signal);
        }

        targetStatus = "failed";
        targetError = error;
      }

      if (targetStatus === "succeeded" && cache !== undefined && cacheKey !== undefined) {
        try {
          await abortable(
            caseSignal.signal,
            Promise.resolve(
              cache.set(
                cacheKey,
                {
                  output: output as Output,
                  targetDurationMs,
                  cachedAt: new Date().toISOString(),
                },
                testCase,
              ),
            ),
          );
        } catch {
          if (options.signal?.aborted === true) {
            throw suiteAbortReason(options.signal);
          }
        }
      }
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
                  targetDurationMs,
                )
              : EvalOutcome.invalid(`Target failed: ${errorMessage(targetError)}`, {
                  kind: targetError instanceof EvalTimeoutError ? "timeout" : "target",
                  error: targetError,
                });
          const durationMs = performance.now() - metricStartedAt;
          const reportInput: Parameters<typeof reportOutcome<Input, Output, Expected>>[0] = {
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
          };

          if (trialCount > 1) {
            reportInput.trial = trial;
            reportInput.trialCount = trialCount;
          }

          if (cached) reportInput.cached = true;

          const reporterErrors = await reportOutcome(reportInput);
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

    const { usage, cost } = await computeCaseUsageAndCost({
      options,
      testCase,
      output,
      targetStatus,
      metrics,
      signal: options.signal,
      cached,
    });

    const execution: SingleTrialExecution<Output> = {
      outcome: caseOutcome(targetStatus, metrics),
      targetStatus,
      targetDurationMs,
      durationMs: performance.now() - trialStartedAt,
      metrics,
      usage,
    };

    if (targetStatus === "succeeded") execution.output = output;

    if (targetStatus === "failed") execution.targetError = targetError;

    if (cached) execution.cached = true;

    if (cost !== undefined) execution.cost = cost;

    return execution;
  } finally {
    caseSignal.dispose();
  }
}

function buildCaseResult<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(args: {
  testCase: EvalCase<Input, Expected>;
  outcome: EvalOutcomeStatus;
  representative: SingleTrialExecution<Output>;
  durationMs: number;
  targetDurationMs: number;
  usage: EvalUsageSummary;
  cost?: EvalCostSummary | undefined;
}): EvalCaseResult<Input, Output, Expected, Metrics> {
  const { testCase, outcome, representative, durationMs, targetDurationMs, usage, cost } = args;
  const scores = Object.fromEntries(
    representative.metrics.map((metric) => [metric.metricName, metric.outcome]),
  ) as EvalCaseResult<Input, Output, Expected, Metrics>["scores"];
  const result: EvalCaseResult<Input, Output, Expected, Metrics> = {
    case: testCase,
    outcome,
    targetStatus: representative.targetStatus,
    targetDurationMs,
    durationMs,
    metrics: representative.metrics as EvalCaseResult<Input, Output, Expected, Metrics>["metrics"],
    scores,
    usage,
  };

  if (representative.targetStatus === "succeeded") {
    result.output = representative.output;
  }

  if (representative.targetStatus === "failed") {
    result.targetError = representative.targetError;
  }

  if (representative.cached === true) {
    result.cached = true;
  }

  if (cost !== undefined) {
    result.cost = cost;
  }

  return result;
}

function resolveMultiTrialOutcome(
  passed: number,
  failed: number,
  invalid: number,
  count: number,
  minPassRate: number,
): EvalOutcomeStatus {
  if (passed / count >= minPassRate) return "pass";

  if (invalid > 0 && (failed === 0 || (passed + failed) / count < minPassRate)) {
    return "invalid";
  }

  return "fail";
}

function selectRepresentativeTrial<Output>(
  executions: Array<SingleTrialExecution<Output>>,
  overallOutcome: EvalOutcomeStatus,
): SingleTrialExecution<Output> {
  const matching = executions.find((entry) => entry.outcome === overallOutcome);
  return matching ?? (executions[0] as SingleTrialExecution<Output>);
}

function aggregateTrialUsage<Output>(
  executions: Array<SingleTrialExecution<Output>>,
): EvalUsageSummary {
  let target = UsageValue.empty();
  let evaluation = UsageValue.empty();
  for (const entry of executions) {
    target = UsageValue.add(target, entry.usage.target);
    evaluation = UsageValue.add(evaluation, entry.usage.evaluation);
  }
  return {
    target,
    evaluation,
    total: UsageValue.add(target, evaluation),
  };
}

function aggregateTrialCost<Output>(
  executions: Array<SingleTrialExecution<Output>>,
): EvalCostSummary | undefined {
  let currency: string | undefined;
  let target = 0;
  let evaluation = 0;
  for (const entry of executions) {
    if (entry.cost === undefined) continue;

    currency = entry.cost.currency;
    target += entry.cost.target;
    evaluation += entry.cost.evaluation;
  }

  if (currency === undefined) return undefined;

  return {
    currency,
    target,
    evaluation,
    total: target + evaluation,
  };
}

export function suiteAbortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason === undefined ? new EvalAbortError() : signal.reason;
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
  targetDurationMs: number,
): Promise<EvalOutcomeType> {
  if (signal.aborted) {
    return EvalOutcome.fromError(
      signal.reason,
      signal.reason instanceof EvalTimeoutError ? "timeout" : undefined,
    );
  }

  try {
    return await abortable(
      signal,
      Promise.resolve(
        metric.evaluate({ suiteName, case: testCase, output, signal, targetDurationMs }),
      ),
    );
  } catch (error) {
    return EvalOutcome.fromError(error, error instanceof EvalTimeoutError ? "timeout" : undefined);
  }
}
