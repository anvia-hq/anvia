import { mapWithConcurrency } from "../internal/concurrency";
import { errorMessage } from "./format";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "./outcome";
import { defaultEvalTraceSelector } from "./reporting";
import type {
  EvalCase,
  EvalCaseResult,
  EvalMetric,
  EvalMetricResult,
  EvalReporter,
  EvalRunContext,
  EvalRunEndArgs,
  EvalRunStartArgs,
  EvalSuiteResult,
  EvalTraceRef,
  RunEvalSuiteOptions,
} from "./types";

export async function runEvalSuite<Input, Output, Expected = unknown>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): Promise<EvalSuiteResult<Input, Output, Expected>> {
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
  let results: Array<EvalCaseResult<Input, Output, Expected>>;
  try {
    results = await mapWithConcurrency(
      options.cases,
      Math.max(1, Math.trunc(options.concurrency ?? 1)),
      (testCase) => runEvalCase(options, testCase, run),
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
  const counts = countOutcomes(results);
  const completedAt = new Date().toISOString();
  const result: EvalSuiteResult<Input, Output, Expected> = {
    name: options.name,
    run: { ...run, completedAt },
    results,
    ...counts,
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
        ...counts,
      },
      options.failOnReporterError === true,
    )),
  );
  return result;
}

async function runEvalCase<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
  run: EvalRunContext,
): Promise<EvalCaseResult<Input, Output, Expected>> {
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
    metrics.push({ metricName: metric.name, outcome, reporterErrors });
  }

  const result: EvalCaseResult<Input, Output, Expected> = {
    case: testCase,
    metrics,
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
  reporters: Array<EvalReporter<Input, Output, Expected>>;
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

async function notifyRunStart(
  reporters: Array<EvalReporter<unknown, unknown, unknown>>,
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

async function notifyRunEnd(
  reporters: Array<EvalReporter<unknown, unknown, unknown>>,
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

function countOutcomes(results: Array<EvalCaseResult<unknown, unknown, unknown>>): {
  passed: number;
  failed: number;
  invalid: number;
} {
  let passed = 0;
  let failed = 0;
  let invalid = 0;
  for (const result of results) {
    for (const metric of result.metrics) {
      if (metric.outcome.outcome === "pass") passed += 1;
      if (metric.outcome.outcome === "fail") failed += 1;
      if (metric.outcome.outcome === "invalid") invalid += 1;
    }
  }
  return { passed, failed, invalid };
}
