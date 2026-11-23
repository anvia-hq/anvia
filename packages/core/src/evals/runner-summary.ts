import { type Usage, Usage as UsageValue } from "../completion";
import type { EvalOutcome as EvalOutcomeType } from "./outcome";
import { projectEvalOutcome } from "./reporting";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCostSummary,
  EvalMetric,
  EvalMetricResult,
  EvalMetricSummary,
  EvalReporter,
  EvalRunContext,
  EvalRunEndArgs,
  EvalRunStartArgs,
  EvalTotals,
  EvalTraceRef,
  EvalTrialOptions,
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
    readonly caseResult?: EvalCaseResult<unknown, unknown, unknown> | undefined,
    readonly partialResults: readonly EvalCaseResult<unknown, unknown, unknown>[] = [],
  ) {
    super(`Evaluation stopped after case ${caseId} produced a required ${outcome} outcome.`);
    this.name = "EvalFailFastError";
  }
}

export function resolveTrialConfig(trials: number | EvalTrialOptions | undefined): {
  count: number;
  minPassRate: number;
} {
  if (trials === undefined) return { count: 1, minPassRate: 1 };

  if (typeof trials === "number") {
    return { count: trials, minPassRate: 1 };
  }

  return {
    count: trials.count,
    minPassRate: trials.minPassRate ?? 1,
  };
}

export function resolveRun<Input, Output, Expected>(
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

  if (options.run?.promptRef !== undefined) run.promptRef = options.run.promptRef;

  if (options.run?.metadata !== undefined) run.metadata = options.run.metadata;

  return run;
}

export async function notifyRunStart<Input, Output, Expected>(
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

export async function notifyRunEnd<Input, Output, Expected>(
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

export async function reportOutcome<Input, Output, Expected>(args: {
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
  trial?: number | undefined;
  trialCount?: number | undefined;
  cached?: boolean | undefined;
}): Promise<unknown[]> {
  const errors: unknown[] = [];

  if (args.traceError !== undefined) {
    errors.push(args.traceError);
  }

  for (const reporter of args.reporters) {
    try {
      const reportArgs: Parameters<EvalReporter<Input, Output, Expected>["report"]>[0] = {
        run: args.run,
        suiteName: args.suiteName,
        case: args.testCase,
        output: args.output,
        targetError: args.targetError,
        targetStatus: args.targetStatus,
        trace: args.trace,
        metric: args.metric,
        outcome: args.outcome,
      };

      if (args.trial !== undefined) reportArgs.trial = args.trial;

      if (args.trialCount !== undefined) reportArgs.trialCount = args.trialCount;

      if (args.cached === true) reportArgs.cached = true;

      await reporter.report(reportArgs);
    } catch (error) {
      errors.push(error);
    }
  }
  throwReporterErrors("report", errors, args.reporterErrorPolicy);
  return errors;
}

export function caseOutcome(
  targetStatus: "succeeded" | "failed",
  metrics: EvalMetricResult[],
): "pass" | "fail" | "invalid" {
  if (targetStatus === "failed") return "invalid";

  const required = metrics.filter((metric) => metric.required);

  if (required.some((metric) => metric.outcome.outcome === "invalid")) return "invalid";

  if (required.some((metric) => metric.outcome.outcome === "fail")) return "fail";

  return "pass";
}

export async function computeCaseUsageAndCost<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(args: {
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>;
  testCase: EvalCase<Input, Expected>;
  output: Output | undefined;
  targetStatus: "succeeded" | "failed";
  metrics: EvalMetricResult[];
  signal: AbortSignal | undefined;
}): Promise<{
  usage: { target: Usage; evaluation: Usage; total: Usage };
  cost?: EvalCostSummary | undefined;
}> {
  const { options, testCase, output, targetStatus, metrics, signal } = args;
  let caseTargetUsage = UsageValue.empty();
  let caseEvaluationUsage = UsageValue.empty();
  let caseTargetCost = 0;
  let caseEvaluationCost = 0;

  if (targetStatus === "succeeded") {
    const usage = await resolveTargetUsage(options, testCase, output as Output, signal);

    if (usage !== undefined) {
      caseTargetUsage = usage;

      if (options.cost !== undefined) {
        caseTargetCost = await calculateCost(
          options.cost.calculate({
            kind: "target",
            suiteName: options.name,
            case: testCase,
            output: output as Output,
            usage,
          }),
        );
      }
    }
  }

  for (const metricResult of metrics) {
    const usage = metricResult.outcome.usage;

    if (usage === undefined) continue;

    assertUsage(usage, `Evaluation usage for metric ${metricResult.metricName}`);
    caseEvaluationUsage = UsageValue.add(caseEvaluationUsage, usage);

    if (options.cost !== undefined && targetStatus === "succeeded") {
      const metric = options.metrics.find(
        (candidate) => candidate.name === metricResult.metricName,
      );

      if (metric !== undefined) {
        const costArgs: {
          kind: "evaluation";
          suiteName: string;
          case: EvalCase<Input, Expected>;
          output: Output;
          metric: EvalMetric<Input, Output, unknown, Expected>;
          usage: Usage;
          model?: { provider: string; modelId: string } | undefined;
        } = {
          kind: "evaluation",
          suiteName: options.name,
          case: testCase,
          output: output as Output,
          metric,
          usage,
        };

        if (metric.model !== undefined) costArgs.model = metric.model;

        const metricCost = await calculateCost(options.cost.calculate(costArgs));
        metricResult.cost = metricCost;
        caseEvaluationCost += metricCost;
      }
    }
  }

  const usage = {
    target: caseTargetUsage,
    evaluation: caseEvaluationUsage,
    total: UsageValue.add(caseTargetUsage, caseEvaluationUsage),
  };

  if (options.cost === undefined) return { usage };

  return {
    usage,
    cost: {
      currency: options.cost.currency,
      target: caseTargetCost,
      evaluation: caseEvaluationCost,
      total: caseTargetCost + caseEvaluationCost,
    },
  };
}

export async function aggregateResult<
  Input,
  Output,
  Expected,
  Metrics extends readonly EvalMetric<Input, Output, unknown, Expected, string>[],
>(
  options: RunEvalSuiteOptions<Input, Output, Expected, Metrics>,
  results: Array<EvalCaseResult<Input, Output, Expected, Metrics>>,
): Promise<{
  passed: boolean;
  metrics: EvalTotals;
  metricSummaries: Record<string, EvalMetricSummary>;
  cases: EvalTotals;
  usage: { target: Usage; evaluation: Usage; total: Usage };
  cost?: EvalCostSummary | undefined;
}> {
  let targetUsage = UsageValue.empty();
  let evaluationUsage = UsageValue.empty();
  let targetCost = 0;
  let evaluationCost = 0;

  for (const result of results) {
    targetUsage = UsageValue.add(targetUsage, result.usage.target);
    evaluationUsage = UsageValue.add(evaluationUsage, result.usage.evaluation);

    if (result.cost !== undefined) {
      targetCost += result.cost.target;
      evaluationCost += result.cost.evaluation;
    }
  }

  const usage = {
    target: targetUsage,
    evaluation: evaluationUsage,
    total: UsageValue.add(targetUsage, evaluationUsage),
  };
  const cases = countCaseOutcomes(results);
  const metrics = countMetricOutcomes(results);
  const metricSummaries = buildMetricSummaries(options.metrics, results);
  const aggregates: {
    passed: boolean;
    metrics: EvalTotals;
    metricSummaries: Record<string, EvalMetricSummary>;
    cases: EvalTotals;
    usage: typeof usage;
    cost?: EvalCostSummary | undefined;
  } = {
    passed: cases.failed === 0 && cases.invalid === 0,
    metrics,
    metricSummaries,
    cases,
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

export function validateSuiteOptions<Input, Output, Expected>(
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

  if (options.trials !== undefined) {
    const { count, minPassRate } = resolveTrialConfig(options.trials);

    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError("Evaluation trials count must be a positive integer");
    }

    if (!Number.isFinite(minPassRate) || minPassRate <= 0 || minPassRate > 1) {
      throw new RangeError("Evaluation trials minPassRate must be in (0, 1]");
    }
  }
}

export function selectCases<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): readonly EvalCase<Input, Expected>[] {
  const requested = options.caseIds === undefined ? undefined : new Set(options.caseIds);
  const requestedTags =
    options.tags !== undefined && options.tags.length > 0 ? new Set(options.tags) : undefined;

  if (requested !== undefined) {
    assertUnique([...options.caseIds!], "Evaluation selected case id");
    const available = new Set(options.cases.map((testCase) => testCase.id));
    for (const id of requested) {
      if (!available.has(id)) {
        throw new TypeError(`Evaluation selected case id was not found: ${id}`);
      }
    }
  }

  const filtered = options.cases.filter(
    (testCase, index) =>
      (requested === undefined || requested.has(testCase.id)) &&
      (requestedTags === undefined ||
        (testCase.tags !== undefined && testCase.tags.some((tag) => requestedTags.has(tag)))) &&
      (options.caseFilter === undefined || options.caseFilter(testCase, index)),
  );

  if (options.shard === undefined) return filtered;

  return filtered.filter((_, index) => index % options.shard!.count === options.shard!.index);
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

function statusKey(status: "pass" | "fail" | "invalid"): "passed" | "failed" | "invalid" {
  if (status === "pass") return "passed";

  if (status === "fail") return "failed";

  return "invalid";
}

function buildMetricSummaries<Input, Output, Expected>(
  metrics: readonly EvalMetric<Input, Output, unknown, Expected, string>[],
  results: Array<EvalCaseResult<Input, Output, Expected>>,
): Record<string, EvalMetricSummary> {
  const summaries: Record<string, EvalMetricSummary> = {};
  for (const metric of metrics) {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let invalid = 0;
    let totalDurationMs = 0;
    const numericScores: number[] = [];

    for (const caseResult of results) {
      const entry = caseResult.metrics.find((candidate) => candidate.metricName === metric.name);

      if (entry === undefined) continue;

      total += 1;
      totalDurationMs += entry.durationMs;

      if (entry.outcome.outcome === "pass") passed += 1;
      else if (entry.outcome.outcome === "fail") failed += 1;
      else invalid += 1;

      if (entry.outcome.outcome !== "invalid") {
        const projection = projectEvalOutcome(entry.outcome, metric.dataType, metric.projectScore);

        if (projection.numericValue !== undefined && Number.isFinite(projection.numericValue)) {
          numericScores.push(projection.numericValue);
        }
      }
    }

    const summary: EvalMetricSummary = {
      metricName: metric.name,
      required: metric.required ?? true,
      total,
      passed,
      failed,
      invalid,
      passRate: total === 0 ? 0 : passed / total,
      meanDurationMs: total === 0 ? 0 : totalDurationMs / total,
    };

    if (metric.direction !== undefined) summary.direction = metric.direction;

    if (metric.threshold !== undefined) summary.threshold = metric.threshold;

    if (numericScores.length > 0) {
      const sum = numericScores.reduce((acc, value) => acc + value, 0);
      summary.meanScore = sum / numericScores.length;
      summary.minScore = Math.min(...numericScores);
      summary.maxScore = Math.max(...numericScores);
    }

    summaries[metric.name] = summary;
  }
  return summaries;
}

async function resolveTargetUsage<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
  output: Output,
  signal: AbortSignal | undefined,
): Promise<Usage | undefined> {
  const usage =
    options.targetUsage === undefined
      ? usageFromOutput(output)
      : await options.targetUsage({
          suiteName: options.name,
          case: testCase,
          output,
          signal: signal ?? new AbortController().signal,
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

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${label} must be unique: ${value}`);

    seen.add(value);
  }
}
