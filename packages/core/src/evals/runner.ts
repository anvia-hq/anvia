import { mapWithConcurrency } from "../internal/concurrency";
import { errorMessage } from "./format";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "./outcome";
import type {
  EvalCase,
  EvalCaseResult,
  EvalMetric,
  EvalMetricResult,
  EvalReporter,
  EvalSuiteResult,
  RunEvalSuiteOptions,
} from "./types";

export async function runEvalSuite<Input, Output, Expected = unknown>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): Promise<EvalSuiteResult<Input, Output, Expected>> {
  const startedAt = Date.now();
  const results = await mapWithConcurrency(
    options.cases,
    Math.max(1, Math.trunc(options.concurrency ?? 1)),
    (testCase) => runEvalCase(options, testCase),
  );
  const counts = countOutcomes(results);
  return {
    name: options.name,
    results,
    ...counts,
    durationMs: Date.now() - startedAt,
  };
}

async function runEvalCase<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
): Promise<EvalCaseResult<Input, Output, Expected>> {
  let output: Output | undefined;
  let targetError: unknown;
  try {
    output = await options.target(testCase.input, testCase);
  } catch (error) {
    targetError = error;
  }

  const metrics: EvalMetricResult[] = [];
  for (const metric of options.metrics) {
    const outcome =
      targetError === undefined
        ? await safeEvaluate(options.name, testCase, output as Output, metric)
        : EvalOutcome.invalid(`Target failed: ${errorMessage(targetError)}`);
    const reporterErrors = await reportOutcome({
      suiteName: options.name,
      testCase,
      output,
      targetError,
      metric,
      outcome,
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
  suiteName: string;
  testCase: EvalCase<Input, Expected>;
  output: Output | undefined;
  targetError: unknown;
  metric: EvalMetric<Input, Output, unknown, Expected>;
  outcome: EvalOutcomeType;
  reporters: Array<EvalReporter<Input, Output, Expected>>;
  failOnReporterError: boolean;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of args.reporters) {
    try {
      await reporter.report({
        suiteName: args.suiteName,
        case: args.testCase,
        output: args.output,
        targetError: args.targetError,
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
