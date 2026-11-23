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
import { caseOutcome, emptyUsageSummary, reportOutcome } from "./runner-summary";
import type {
  EvalCase,
  EvalCaseResult,
  EvalMetric,
  EvalMetricResult,
  EvalProgressEvent,
  EvalRunContext,
  EvalTraceRef,
  RunEvalSuiteOptions,
} from "./types";

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
  const caseSignal = createEvalCaseSignal(options.signal, options.caseTimeoutMs);
  try {
    const progress = (event: EvalProgressEvent<Input, Output, Expected>) =>
      options.onProgress?.(event);
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
        throw suiteAbortReason(options.signal);
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
