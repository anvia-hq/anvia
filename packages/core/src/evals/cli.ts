import { runEvalSuite } from "./runner";
import type {
  EvalMetric,
  EvalOutcomeStatus,
  EvalSuiteResult,
  EvalTotals,
  RunEvalSuiteOptions,
} from "./types";

export type EvalOutputFormat = "pretty" | "json" | "quiet";

export type EvalExpectedTotals = Partial<EvalTotals> & {
  metrics?: Partial<EvalTotals> | undefined;
  cases?: Partial<EvalTotals> | undefined;
};

export type EvalExpectedOutcomes = Record<string, Record<string, EvalOutcomeStatus>>;

export type EvalExpectations = {
  totals?: EvalExpectedTotals | undefined;
  outcomes?: EvalExpectedOutcomes | undefined;
};

export type EvalOutputWriters = {
  stdout?(text: string): void;
  stderr?(text: string): void;
};

export type EvalRedactionContext = {
  kind:
    | "input"
    | "expected"
    | "context"
    | "retrievalContext"
    | "output"
    | "score"
    | "comment"
    | "metadata"
    | "error";
  caseId?: string | undefined;
  metricName?: string | undefined;
};

export type EvalRedactor = (value: unknown, context: EvalRedactionContext) => unknown;

export type PrintEvalResultOptions = {
  format?: EvalOutputFormat | undefined;
  output?: EvalOutputWriters | undefined;
  maxValueLength?: number | undefined;
  redact?: EvalRedactor | undefined;
};

type EvalSuiteShape = {
  cases: readonly { id: string }[];
  metrics: readonly { name: string }[];
};

export type EvalExpectedOutcomesFor<Suite extends EvalSuiteShape> = Partial<
  Record<
    Suite["cases"][number]["id"],
    Partial<Record<Suite["metrics"][number]["name"], EvalOutcomeStatus>>
  >
>;

export type EvalExpectationsFor<Suite extends EvalSuiteShape> = Omit<
  EvalExpectations,
  "outcomes"
> & {
  outcomes?: EvalExpectedOutcomesFor<Suite> | undefined;
};

export type RunEvalCliOptions<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly EvalMetric<
    NoInfer<Input>,
    NoInfer<Output>,
    unknown,
    NoInfer<Expected>,
    string
  >[] = readonly EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>, string>[],
> = RunEvalSuiteOptions<Input, Output, Expected, Metrics> & {
  format?: EvalOutputFormat | undefined;
  exitCode?: boolean | undefined;
  expectations?: EvalExpectations | undefined;
  output?: EvalOutputWriters | undefined;
  maxValueLength?: number | undefined;
  redact?: EvalRedactor | undefined;
};

export class EvalAssertionError extends Error {
  readonly mismatches: string[];

  constructor(message: string, mismatches: string[]) {
    super(`${message}\n${mismatches.map((mismatch) => `- ${mismatch}`).join("\n")}`);
    this.name = "EvalAssertionError";
    this.mismatches = mismatches;
  }
}

export function defineEvalExpectations<const Suite extends EvalSuiteShape>(
  _suite: Suite,
  expectations: EvalExpectationsFor<NoInfer<Suite>>,
): EvalExpectationsFor<Suite> {
  return expectations;
}

export function formatEvalResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: Omit<PrintEvalResultOptions, "output"> = {},
): string {
  const format = options.format ?? "pretty";
  if (format === "quiet") return "";
  validatePrintOptions(options);
  return format === "json" ? jsonResult(result, options) : prettyResult(result, options);
}

export function printEvalResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: PrintEvalResultOptions = {},
): void {
  const format = options.format ?? "pretty";
  if (format === "quiet") return;
  const write = options.output?.stdout ?? ((text: string) => process.stdout.write(text));
  write(`${formatEvalResult(result, options)}\n`);
}

export function evalExitCode(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expectations?: EvalExpectations,
): 0 | 1 | 2 {
  const hasExpectations =
    expectations?.totals !== undefined || expectations?.outcomes !== undefined;
  const mismatches = hasExpectations ? expectationMismatches(result, expectations) : [];
  if (hasExpectations && mismatches.length === 0) return 0;
  if (hasExpectations && hasUnexpectedInvalid(result, expectations)) return 2;
  if (hasExpectations) return 1;
  if (requiredMetricCount(result, "invalid") > 0) return 2;
  return requiredMetricCount(result, "fail") > 0 ? 1 : 0;
}

export function assertEvalTotals(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expected: EvalExpectedTotals,
): void {
  const mismatches = totalMismatches(result, expected);
  if (mismatches.length > 0) {
    throw new EvalAssertionError("Evaluation totals did not match expectations.", mismatches);
  }
}

export function assertEvalOutcomes(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expected: EvalExpectedOutcomes,
): void {
  const mismatches = outcomeMismatches(result, expected);
  if (mismatches.length > 0) {
    throw new EvalAssertionError("Evaluation outcomes did not match expectations.", mismatches);
  }
}

export async function runEvalCli<
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
  options: RunEvalCliOptions<Input, Output, Expected, Metrics>,
): Promise<EvalSuiteResult<Input, Output, Expected, Metrics>> {
  const { format, exitCode, expectations, output, maxValueLength, redact, ...suiteOptions } =
    options;
  const result = await runEvalSuite(
    suiteOptions as RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  );
  printEvalResult(result, { format, output, maxValueLength, redact });
  const code = evalExitCode(result, expectations);
  const mismatches = expectationMismatches(result, expectations);
  if (mismatches.length > 0 && format !== "quiet") {
    const write = output?.stderr ?? ((text: string) => process.stderr.write(text));
    write(
      `Evaluation expectation mismatches:\n${mismatches.map((value) => `- ${value}`).join("\n")}\n`,
    );
  }
  const currentExitCode =
    typeof process.exitCode === "number" ? process.exitCode : Number(process.exitCode ?? 0);
  if (exitCode === true && code > currentExitCode) process.exitCode = code;
  return result;
}

function prettyResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: Omit<PrintEvalResultOptions, "output">,
): string {
  const lines = [
    `${result.name} (${result.run.id})`,
    `Cases: ${totalsText(result.cases)}`,
    `Metrics: ${totalsText(result.metrics)}`,
  ];
  for (const caseResult of result.results) {
    lines.push(``, `[${caseResult.outcome.toUpperCase()}] ${caseResult.case.id}`);
    if (caseResult.targetStatus === "succeeded") {
      lines.push(
        `  output: ${displayValue(
          redact(caseResult.output, options, { kind: "output", caseId: caseResult.case.id }),
          options.maxValueLength,
        )}`,
      );
    }
    if (caseResult.targetStatus === "failed") {
      lines.push(
        `  target error: ${errorText(
          redact(caseResult.targetError, options, { kind: "error", caseId: caseResult.case.id }),
          options.maxValueLength,
        )}`,
      );
    }
    for (const metric of caseResult.metrics) {
      const parts = [`  - ${metric.metricName}: ${metric.outcome.outcome}`];
      if (metric.outcome.score !== undefined) {
        parts.push(
          `score=${displayValue(
            redact(metric.outcome.score, options, {
              kind: "score",
              caseId: caseResult.case.id,
              metricName: metric.metricName,
            }),
            options.maxValueLength,
          )}`,
        );
      }
      if (metric.threshold !== undefined) parts.push(`threshold=${metric.threshold}`);
      if (metric.direction !== undefined) parts.push(`direction=${metric.direction}`);
      if (!metric.required) parts.push("optional");
      lines.push(parts.join(" | "));
      const explanation =
        metric.outcome.comment ??
        (metric.outcome.outcome === "invalid" ? metric.outcome.reason : undefined);
      if (explanation !== undefined) {
        lines.push(
          `    ${displayValue(
            redact(explanation, options, {
              kind: "comment",
              caseId: caseResult.case.id,
              metricName: metric.metricName,
            }),
            options.maxValueLength,
          )}`,
        );
      }
    }
  }
  lines.push(
    ``,
    `Usage: target=${result.usage.target.totalTokens} evaluation=${result.usage.evaluation.totalTokens} total=${result.usage.total.totalTokens} tokens`,
  );
  if (result.cost !== undefined) {
    lines.push(
      `Cost: target=${result.cost.target} evaluation=${result.cost.evaluation} total=${result.cost.total} ${result.cost.currency}`,
    );
  }
  lines.push(`Duration: ${result.durationMs}ms`);
  return lines.join("\n");
}

function jsonResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: Omit<PrintEvalResultOptions, "output">,
): string {
  return JSON.stringify(
    redactJsonResult(result, options),
    (_key, value: unknown) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (value instanceof RegExp) return String(value);
      if (typeof value === "string") return truncate(value, options.maxValueLength);
      return value;
    },
    2,
  );
}

function expectationMismatches(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expectations?: EvalExpectations,
): string[] {
  if (expectations === undefined) return [];
  const mismatches: string[] = [];
  if (expectations.totals !== undefined) {
    mismatches.push(...totalMismatches(result, expectations.totals));
  }
  if (expectations.outcomes !== undefined) {
    mismatches.push(...outcomeMismatches(result, expectations.outcomes));
  }
  return mismatches;
}

function totalMismatches(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expected: EvalExpectedTotals,
): string[] {
  const directMetrics: Partial<EvalTotals> = {};
  if (expected.total !== undefined) directMetrics.total = expected.total;
  if (expected.passed !== undefined) directMetrics.passed = expected.passed;
  if (expected.failed !== undefined) directMetrics.failed = expected.failed;
  if (expected.invalid !== undefined) directMetrics.invalid = expected.invalid;
  return [
    ...totalsGroupMismatches("metrics", result.metrics, {
      ...directMetrics,
      ...expected.metrics,
    }),
    ...totalsGroupMismatches("cases", result.cases, expected.cases),
  ];
}

function totalsGroupMismatches(
  label: string,
  actual: EvalTotals,
  expected: Partial<EvalTotals> | undefined,
): string[] {
  if (expected === undefined) return [];
  const mismatches: string[] = [];
  for (const key of ["total", "passed", "failed", "invalid"] as const) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) {
      mismatches.push(`${label}.${key}: expected ${expected[key]}, received ${actual[key]}`);
    }
  }
  return mismatches;
}

function outcomeMismatches(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expected: EvalExpectedOutcomes,
): string[] {
  const mismatches: string[] = [];
  const actualCases = new Map(result.results.map((caseResult) => [caseResult.case.id, caseResult]));
  for (const [caseId, metrics] of Object.entries(expected)) {
    const caseResult = actualCases.get(caseId);
    if (caseResult === undefined) {
      mismatches.push(`${caseId}: expected case was not present`);
      continue;
    }
    for (const [metricName, expectedOutcome] of Object.entries(metrics)) {
      const metric = caseResult.metrics.find((candidate) => candidate.metricName === metricName);
      if (metric === undefined) {
        mismatches.push(`${caseId}.${metricName}: expected metric was not present`);
      } else if (metric.outcome.outcome !== expectedOutcome) {
        mismatches.push(
          `${caseId}.${metricName}: expected ${expectedOutcome}, received ${metric.outcome.outcome}`,
        );
      }
    }
  }
  for (const caseResult of result.results) {
    for (const metric of caseResult.metrics) {
      if (!metric.required) continue;
      const expectedOutcome = expected[caseResult.case.id]?.[metric.metricName] ?? "pass";
      if (metric.outcome.outcome !== expectedOutcome) {
        const message = `${caseResult.case.id}.${metric.metricName}: expected ${expectedOutcome}, received ${metric.outcome.outcome}`;
        if (!mismatches.includes(message)) mismatches.push(message);
      }
    }
  }
  return mismatches;
}

function hasUnexpectedInvalid(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  expectations: EvalExpectations | undefined,
): boolean {
  if (expectations?.outcomes !== undefined) {
    return result.results.some((caseResult) =>
      caseResult.metrics.some(
        (metric) =>
          metric.required &&
          metric.outcome.outcome === "invalid" &&
          expectations.outcomes?.[caseResult.case.id]?.[metric.metricName] !== "invalid",
      ),
    );
  }
  const expectedInvalid = expectations?.totals?.metrics?.invalid ?? expectations?.totals?.invalid;
  return result.metrics.invalid > (expectedInvalid ?? 0);
}

function requiredMetricCount(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  status: "fail" | "invalid",
): number {
  return result.results.reduce(
    (total, caseResult) =>
      total +
      caseResult.metrics.filter((metric) => metric.required && metric.outcome.outcome === status)
        .length,
    0,
  );
}

function totalsText(totals: EvalTotals): string {
  return `${totals.total} total / ${totals.passed} pass / ${totals.failed} fail / ${totals.invalid} invalid`;
}

function displayValue(value: unknown, maxValueLength?: number): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return truncate(text, maxValueLength);
}

function errorText(error: unknown, maxValueLength?: number): string {
  return truncate(error instanceof Error ? error.message : displayValue(error), maxValueLength);
}

function truncate(value: string, maxValueLength: number | undefined): string {
  return maxValueLength !== undefined && value.length > maxValueLength
    ? `${value.slice(0, maxValueLength)}…`
    : value;
}

function redact(
  value: unknown,
  options: Omit<PrintEvalResultOptions, "output">,
  context: EvalRedactionContext,
): unknown {
  return options.redact === undefined ? value : options.redact(value, context);
}

function redactJsonResult(
  result: EvalSuiteResult<unknown, unknown, unknown>,
  options: Omit<PrintEvalResultOptions, "output">,
): unknown {
  return {
    ...result,
    run: {
      ...result.run,
      metadata:
        result.run.metadata === undefined
          ? undefined
          : (redact(result.run.metadata, options, {
              kind: "metadata",
            }) as typeof result.run.metadata),
    },
    results: result.results.map((caseResult) => ({
      ...caseResult,
      case: {
        ...caseResult.case,
        input: redact(caseResult.case.input, options, {
          kind: "input",
          caseId: caseResult.case.id,
        }),
        expected: redact(caseResult.case.expected, options, {
          kind: "expected",
          caseId: caseResult.case.id,
        }),
        context: redact(caseResult.case.context, options, {
          kind: "context",
          caseId: caseResult.case.id,
        }),
        retrievalContext: redact(caseResult.case.retrievalContext, options, {
          kind: "retrievalContext",
          caseId: caseResult.case.id,
        }),
        metadata:
          caseResult.case.metadata === undefined
            ? undefined
            : (redact(caseResult.case.metadata, options, {
                kind: "metadata",
                caseId: caseResult.case.id,
              }) as typeof caseResult.case.metadata),
      },
      output:
        caseResult.targetStatus === "succeeded"
          ? redact(caseResult.output, options, { kind: "output", caseId: caseResult.case.id })
          : undefined,
      targetError:
        caseResult.targetStatus === "failed"
          ? redact(caseResult.targetError, options, {
              kind: "error",
              caseId: caseResult.case.id,
            })
          : undefined,
      metrics: caseResult.metrics.map((metric) => ({
        ...metric,
        reporterErrors: metric.reporterErrors.map((error) =>
          redact(error, options, {
            kind: "error",
            caseId: caseResult.case.id,
            metricName: metric.metricName,
          }),
        ),
        outcome: redactOutcome(metric.outcome, options, caseResult.case.id, metric.metricName),
      })),
      scores: Object.fromEntries(
        caseResult.metrics.map((metric) => [
          metric.metricName,
          redactOutcome(metric.outcome, options, caseResult.case.id, metric.metricName),
        ]),
      ),
    })),
    reporterErrors: result.reporterErrors.map((error) => redact(error, options, { kind: "error" })),
  };
}

function redactOutcome(
  outcome: EvalSuiteResult<
    unknown,
    unknown,
    unknown
  >["results"][number]["metrics"][number]["outcome"],
  options: Omit<PrintEvalResultOptions, "output">,
  caseId: string,
  metricName: string,
): unknown {
  return {
    ...outcome,
    ...(outcome.score === undefined
      ? {}
      : { score: redact(outcome.score, options, { kind: "score", caseId, metricName }) }),
    ...(outcome.comment === undefined
      ? {}
      : { comment: redact(outcome.comment, options, { kind: "comment", caseId, metricName }) }),
    ...(!("reason" in outcome) || outcome.reason === undefined
      ? {}
      : { reason: redact(outcome.reason, options, { kind: "comment", caseId, metricName }) }),
    ...(outcome.metadata === undefined
      ? {}
      : {
          metadata: redact(outcome.metadata, options, {
            kind: "metadata",
            caseId,
            metricName,
          }),
        }),
    ...(!("error" in outcome) || outcome.error === undefined
      ? {}
      : { error: redact(outcome.error, options, { kind: "error", caseId, metricName }) }),
  };
}

function validatePrintOptions(options: Omit<PrintEvalResultOptions, "output">): void {
  if (
    options.maxValueLength !== undefined &&
    (!Number.isSafeInteger(options.maxValueLength) || options.maxValueLength < 1)
  ) {
    throw new RangeError("Evaluation maxValueLength must be a positive integer.");
  }
}
