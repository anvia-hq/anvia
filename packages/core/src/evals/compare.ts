import type { EvalOutputWriters } from "./cli";
import { projectEvalOutcome } from "./reporting";
import { runEvalSuite } from "./runner";
import type {
  AnyEvalMetric,
  EvalMetric,
  EvalOutcomeStatus,
  EvalScoreDirection,
  EvalSuiteResult,
  EvalTarget,
  RunEvalSuiteOptions,
} from "./types";

export type EvalComparisonItem = {
  caseId: string;
  metricName: string;
  baselineOutcome: EvalOutcomeStatus;
  candidateOutcome: EvalOutcomeStatus;
  baselineScore?: number | undefined;
  candidateScore?: number | undefined;
  scoreDelta?: number | undefined;
  direction?: EvalScoreDirection | undefined;
  kind: "regression" | "improvement" | "unchanged";
};

export type EvalMetricDelta = {
  metricName: string;
  baselinePassRate: number;
  candidatePassRate: number;
  passRateDelta: number;
  baselineMeanScore?: number | undefined;
  candidateMeanScore?: number | undefined;
  meanScoreDelta?: number | undefined;
  direction?: EvalScoreDirection | undefined;
};

export type EvalComparisonResult = {
  baselineName: string;
  candidateName: string;
  baselineRunId: string;
  candidateRunId: string;
  hasRegressions: boolean;
  regressions: EvalComparisonItem[];
  improvements: EvalComparisonItem[];
  unchanged: number;
  addedCases: string[];
  removedCases: string[];
  metricDeltas: Record<string, EvalMetricDelta>;
  durationDeltaMs: number;
  usageDelta: {
    targetTokens: number;
    evaluationTokens: number;
    totalTokens: number;
  };
  costDelta?:
    | {
        currency: string;
        target: number;
        evaluation: number;
        total: number;
      }
    | undefined;
};

export type CompareEvalResultsOptions = {
  scoreTolerance?: number | undefined;
};

/** Compares a candidate eval result against a baseline to surface regressions, improvements, and metric deltas. */
export function compareEvalResults(
  baseline: EvalSuiteResult<unknown, unknown, unknown>,
  candidate: EvalSuiteResult<unknown, unknown, unknown>,
  options: CompareEvalResultsOptions = {},
): EvalComparisonResult {
  const tolerance = options.scoreTolerance ?? 1e-9;
  const baselineCases = new Map(baseline.results.map((entry) => [entry.case.id, entry]));
  const candidateCases = new Map(candidate.results.map((entry) => [entry.case.id, entry]));

  const addedCases: string[] = [];
  const removedCases: string[] = [];
  const regressions: EvalComparisonItem[] = [];
  const improvements: EvalComparisonItem[] = [];
  let unchanged = 0;

  for (const caseId of candidateCases.keys()) {
    if (!baselineCases.has(caseId)) addedCases.push(caseId);
  }

  for (const caseId of baselineCases.keys()) {
    if (!candidateCases.has(caseId)) removedCases.push(caseId);
  }

  for (const [caseId, baseCase] of baselineCases) {
    const candCase = candidateCases.get(caseId);

    if (candCase === undefined) continue;

    const candMetrics = new Map(candCase.metrics.map((metric) => [metric.metricName, metric]));
    for (const baseMetric of baseCase.metrics) {
      const candMetric = candMetrics.get(baseMetric.metricName);

      if (candMetric === undefined) continue;

      const baseScore = extractNumericScore(baseMetric.outcome);
      const candScore = extractNumericScore(candMetric.outcome);
      const direction = candMetric.direction ?? baseMetric.direction;
      const scoreDelta =
        baseScore !== undefined && candScore !== undefined ? candScore - baseScore : undefined;
      const kind = classifyDelta({
        baselineOutcome: baseMetric.outcome.outcome,
        candidateOutcome: candMetric.outcome.outcome,
        scoreDelta,
        direction,
        tolerance,
      });

      const item: EvalComparisonItem = {
        caseId,
        metricName: baseMetric.metricName,
        baselineOutcome: baseMetric.outcome.outcome,
        candidateOutcome: candMetric.outcome.outcome,
        kind,
      };

      if (baseScore !== undefined) item.baselineScore = baseScore;

      if (candScore !== undefined) item.candidateScore = candScore;

      if (scoreDelta !== undefined) item.scoreDelta = scoreDelta;

      if (direction !== undefined) item.direction = direction;

      if (kind === "regression") regressions.push(item);
      else if (kind === "improvement") improvements.push(item);
      else unchanged += 1;
    }
  }

  const metricDeltas = computeMetricDeltas(baseline, candidate);
  const comparison: EvalComparisonResult = {
    baselineName: baseline.name,
    candidateName: candidate.name,
    baselineRunId: baseline.run.id,
    candidateRunId: candidate.run.id,
    hasRegressions: regressions.length > 0,
    regressions,
    improvements,
    unchanged,
    addedCases,
    removedCases,
    metricDeltas,
    durationDeltaMs: candidate.durationMs - baseline.durationMs,
    usageDelta: {
      targetTokens: candidate.usage.target.totalTokens - baseline.usage.target.totalTokens,
      evaluationTokens:
        candidate.usage.evaluation.totalTokens - baseline.usage.evaluation.totalTokens,
      totalTokens: candidate.usage.total.totalTokens - baseline.usage.total.totalTokens,
    },
  };

  if (
    baseline.cost !== undefined &&
    candidate.cost !== undefined &&
    baseline.cost.currency === candidate.cost.currency
  ) {
    comparison.costDelta = {
      currency: candidate.cost.currency,
      target: candidate.cost.target - baseline.cost.target,
      evaluation: candidate.cost.evaluation - baseline.cost.evaluation,
      total: candidate.cost.total - baseline.cost.total,
    };
  }

  return comparison;
}

/** Formats an EvalComparisonResult into a human-readable diff report. */
export function formatEvalComparison(comparison: EvalComparisonResult): string {
  const lines = [
    `Comparison: ${comparison.baselineName} (${comparison.baselineRunId}) -> ${comparison.candidateName} (${comparison.candidateRunId})`,
    `Summary: ${comparison.regressions.length} regression(s) / ${comparison.improvements.length} improvement(s) / ${comparison.unchanged} unchanged`,
  ];

  const metricEntries = Object.values(comparison.metricDeltas);

  if (metricEntries.length > 0) {
    lines.push("", "Metric deltas:");
    for (const delta of metricEntries) {
      const parts = [
        `  - ${delta.metricName}: passRate ${formatPercent(delta.baselinePassRate)} -> ${formatPercent(delta.candidatePassRate)} (${formatSignedPercent(delta.passRateDelta)})`,
      ];

      if (
        delta.baselineMeanScore !== undefined &&
        delta.candidateMeanScore !== undefined &&
        delta.meanScoreDelta !== undefined
      ) {
        parts.push(
          `mean ${delta.baselineMeanScore.toFixed(3)} -> ${delta.candidateMeanScore.toFixed(3)} (${formatSignedNumber(delta.meanScoreDelta)})`,
        );
      }

      lines.push(parts.join(" | "));
    }
  }

  if (comparison.regressions.length > 0) {
    lines.push("", "Regressions:");
    for (const item of comparison.regressions) {
      lines.push(`  - ${item.caseId}.${item.metricName}: ${formatItemChange(item)}`);
    }
  }

  if (comparison.improvements.length > 0) {
    lines.push("", "Improvements:");
    for (const item of comparison.improvements) {
      lines.push(`  - ${item.caseId}.${item.metricName}: ${formatItemChange(item)}`);
    }
  }

  if (comparison.addedCases.length > 0) {
    lines.push("", `Added cases: ${comparison.addedCases.join(", ")}`);
  }

  if (comparison.removedCases.length > 0) {
    lines.push("", `Removed cases: ${comparison.removedCases.join(", ")}`);
  }

  lines.push(
    "",
    `Usage delta: ${formatSignedInt(comparison.usageDelta.totalTokens)} tokens (target=${formatSignedInt(comparison.usageDelta.targetTokens)}, evaluation=${formatSignedInt(comparison.usageDelta.evaluationTokens)})`,
  );

  if (comparison.costDelta !== undefined) {
    lines.push(
      `Cost delta: ${formatSignedNumber(comparison.costDelta.total)} ${comparison.costDelta.currency}`,
    );
  }

  lines.push(`Duration delta: ${formatSignedInt(Math.round(comparison.durationDeltaMs))}ms`);
  return lines.join("\n");
}

/** Prints a formatted eval comparison report to stdout or a custom writer. */
export function printEvalComparison(
  comparison: EvalComparisonResult,
  output?: EvalOutputWriters,
): void {
  const write = output?.stdout ?? ((text: string) => process.stdout.write(text));
  write(`${formatEvalComparison(comparison)}\n`);
}

/** Persists an EvalSuiteResult snapshot to disk as JSON for later baseline comparisons. */
export async function saveEvalResult(
  filePath: string,
  result: EvalSuiteResult<unknown, unknown, unknown>,
): Promise<void> {
  const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(
    result,
    (_key, value: unknown) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }

      if (value instanceof RegExp) return String(value);

      return value;
    },
    2,
  );
  await fs.writeFile(filePath, `${serialized}\n`, "utf8");
}

/** Loads a previously saved EvalSuiteResult snapshot from disk. */
export async function loadEvalResult(
  filePath: string,
): Promise<EvalSuiteResult<unknown, unknown, unknown>> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(content);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    !("results" in parsed) ||
    !Array.isArray((parsed as { results?: unknown }).results)
  ) {
    throw new TypeError(`File ${filePath} does not contain a valid EvalSuiteResult snapshot.`);
  }

  return parsed as EvalSuiteResult<unknown, unknown, unknown>;
}

export type CompareEvalTargetsOptions<
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
> = Omit<RunEvalSuiteOptions<Input, Output, Expected, Metrics>, "target"> & {
  targets: Record<string, EvalTarget<Input, Output, Expected>>;
  baselineTarget?: string | undefined;
  scoreTolerance?: number | undefined;
};

export type CompareEvalTargetsResult<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly AnyEvalMetric[] = readonly AnyEvalMetric[],
> = {
  name: string;
  baselineTarget: string;
  results: Record<string, EvalSuiteResult<Input, Output, Expected, Metrics>>;
  comparisons: Record<string, EvalComparisonResult>;
};

/** Runs the same cases and metrics against multiple named targets and compares each against a baseline target. */
export async function compareEvalTargets<
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
  options: CompareEvalTargetsOptions<Input, Output, Expected, Metrics>,
): Promise<CompareEvalTargetsResult<Input, Output, Expected, Metrics>> {
  const targetNames = Object.keys(options.targets);

  if (targetNames.length === 0) {
    throw new TypeError("compareEvalTargets requires at least one named target.");
  }

  const baselineTarget = options.baselineTarget ?? (targetNames[0] as string);

  if (!Object.hasOwn(options.targets, baselineTarget)) {
    throw new TypeError(`Baseline target "${baselineTarget}" was not found in targets.`);
  }

  const { targets, baselineTarget: _baseline, scoreTolerance, ...suiteOptions } = options;
  const results: Record<string, EvalSuiteResult<Input, Output, Expected, Metrics>> = {};

  for (const [targetName, target] of Object.entries(targets)) {
    results[targetName] = await runEvalSuite({
      ...(suiteOptions as Omit<RunEvalSuiteOptions<Input, Output, Expected, Metrics>, "target">),
      name: `${options.name}:${targetName}`,
      target,
    });
  }

  const baselineResult = results[baselineTarget] as EvalSuiteResult<
    Input,
    Output,
    Expected,
    Metrics
  >;
  const comparisons: Record<string, EvalComparisonResult> = {};

  for (const [targetName, result] of Object.entries(results)) {
    if (targetName === baselineTarget) continue;

    comparisons[targetName] = compareEvalResults(
      baselineResult as EvalSuiteResult<unknown, unknown, unknown>,
      result as EvalSuiteResult<unknown, unknown, unknown>,
      { scoreTolerance },
    );
  }

  return {
    name: options.name,
    baselineTarget,
    results,
    comparisons,
  };
}

function outcomeRank(status: EvalOutcomeStatus): number {
  if (status === "pass") return 2;

  if (status === "fail") return 1;

  return 0;
}

function classifyDelta(args: {
  baselineOutcome: EvalOutcomeStatus;
  candidateOutcome: EvalOutcomeStatus;
  scoreDelta: number | undefined;
  direction: EvalScoreDirection | undefined;
  tolerance: number;
}): "regression" | "improvement" | "unchanged" {
  const rankDelta = outcomeRank(args.candidateOutcome) - outcomeRank(args.baselineOutcome);

  if (rankDelta < 0) return "regression";

  if (rankDelta > 0) return "improvement";

  if (args.scoreDelta === undefined || Math.abs(args.scoreDelta) <= args.tolerance) {
    return "unchanged";
  }

  const lowerIsBetter = args.direction === "lower_is_better";
  const improved = lowerIsBetter ? args.scoreDelta < 0 : args.scoreDelta > 0;
  return improved ? "improvement" : "regression";
}

function extractNumericScore(
  outcome: EvalSuiteResult<
    unknown,
    unknown,
    unknown
  >["results"][number]["metrics"][number]["outcome"],
): number | undefined {
  if (outcome.outcome === "invalid") return undefined;

  const projection = projectEvalOutcome(outcome, undefined);
  return projection.numericValue;
}

function computeMetricDeltas(
  baseline: EvalSuiteResult<unknown, unknown, unknown>,
  candidate: EvalSuiteResult<unknown, unknown, unknown>,
): Record<string, EvalMetricDelta> {
  const baseSummaries = baseline.metricSummaries ?? {};
  const candSummaries = candidate.metricSummaries ?? {};
  const metricNames = new Set([...Object.keys(baseSummaries), ...Object.keys(candSummaries)]);
  const deltas: Record<string, EvalMetricDelta> = {};

  for (const metricName of metricNames) {
    const base = baseSummaries[metricName];
    const cand = candSummaries[metricName];

    if (base === undefined || cand === undefined) continue;

    const delta: EvalMetricDelta = {
      metricName,
      baselinePassRate: base.passRate,
      candidatePassRate: cand.passRate,
      passRateDelta: cand.passRate - base.passRate,
    };

    const direction = cand.direction ?? base.direction;

    if (direction !== undefined) delta.direction = direction;

    if (base.meanScore !== undefined && cand.meanScore !== undefined) {
      delta.baselineMeanScore = base.meanScore;
      delta.candidateMeanScore = cand.meanScore;
      delta.meanScoreDelta = cand.meanScore - base.meanScore;
    }

    deltas[metricName] = delta;
  }

  return deltas;
}

function formatItemChange(item: EvalComparisonItem): string {
  const outcomePart = `${item.baselineOutcome} -> ${item.candidateOutcome}`;

  if (
    item.baselineScore !== undefined &&
    item.candidateScore !== undefined &&
    item.scoreDelta !== undefined
  ) {
    return `${outcomePart} (score ${item.baselineScore.toFixed(3)} -> ${item.candidateScore.toFixed(3)}, ${formatSignedNumber(item.scoreDelta)})`;
  }

  return outcomePart;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatSignedPercent(delta: number): string {
  const pct = (delta * 100).toFixed(1);
  return delta > 0 ? `+${pct}%` : `${pct}%`;
}

function formatSignedNumber(delta: number): string {
  const formatted = delta.toFixed(3);
  return delta > 0 ? `+${formatted}` : formatted;
}

function formatSignedInt(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}
