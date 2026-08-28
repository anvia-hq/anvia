import type { JsonObject, Usage } from "../completion";
import type { EvalOutcome } from "./outcome";

export type EvalMetadata = JsonObject;
export type EvalReporterErrorPolicy = "collect" | "throw";
export type EvalInvalidKind = "target" | "metric" | "configuration" | "provider" | "timeout";

export type EvalRunOptions = {
  id?: string | undefined;
  datasetName?: string | undefined;
  datasetVersion?: string | undefined;
  metadata?: EvalMetadata | undefined;
};

export type EvalRunContext = {
  id: string;
  startedAt: string;
  datasetName?: string | undefined;
  datasetVersion?: string | undefined;
  metadata?: EvalMetadata | undefined;
};

export type EvalCase<Input, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected | undefined;
  context?: string[] | undefined;
  retrievalContext?: string[] | undefined;
  metadata?: EvalMetadata | undefined;
};

export type EvalTurn = {
  role: "user" | "assistant";
  content: string;
  metadata?: EvalMetadata | undefined;
};

export type EvalTraceRef = {
  observer?: string | undefined;
  traceId: string;
  observationId?: string | undefined;
  responseId?: string | undefined;
};

export type EvalTarget<Input, Output, Expected = unknown> = (
  input: Input,
  testCase: EvalCase<Input, Expected>,
  context?: EvalTargetContext,
) => Output | Promise<Output>;

export type EvalTargetContext = {
  signal: AbortSignal;
};

export type EvalOutcomeStatus = "pass" | "fail" | "invalid";

export type EvalScoreDirection = "higher_is_better" | "lower_is_better";

export type EvalDataType = "NUMERIC" | "CATEGORICAL" | "BOOLEAN";

export type EvalTraceCarrier = {
  trace: EvalTraceRef;
};

export type DefaultEvalActual<Output> = Output extends { output: infer Text extends string }
  ? Text
  : Output;

export type EvalCaseRequirements = {
  expected?: unknown;
  context?: string[];
  retrievalContext?: string[];
};

export type EvalTotals = {
  total: number;
  passed: number;
  failed: number;
  invalid: number;
};

export type EvalUsageSummary = {
  target: Usage;
  evaluation: Usage;
  total: Usage;
};

export type EvalCostSummary = {
  currency: string;
  target: number;
  evaluation: number;
  total: number;
};

export type EvalScoreProjection = {
  outcome: EvalOutcomeStatus;
  value: number | string;
  numericValue?: number | undefined;
  categoricalValue?: string | undefined;
  label: string;
  explanation?: string | undefined;
};

export type EvalMetricArgs<Input, Output, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output: Output;
  signal: AbortSignal;
};

export type EvalMetric<
  Input,
  Output,
  Score = unknown,
  Expected = unknown,
  Name extends string = string,
  Requirements extends EvalCaseRequirements = Record<never, never>,
> = {
  name: Name;
  required?: boolean | undefined;
  direction?: EvalScoreDirection | undefined;
  threshold?: number | undefined;
  dataType?: EvalDataType | undefined;
  projectScore?(score: Score): number | string | boolean;
  scoreConfigId?: string | undefined;
  configId?: string | undefined;
  metadata?: EvalMetadata | undefined;
  readonly caseRequirements?: Requirements | undefined;
  evaluate(
    args: EvalMetricArgs<Input, Output, Expected>,
  ): EvalOutcome<Score> | Promise<EvalOutcome<Score>>;
};

export type EvalMetricResult<Score = unknown, Name extends string = string> = {
  metricName: Name;
  required: boolean;
  direction?: EvalScoreDirection | undefined;
  threshold?: number | undefined;
  outcome: EvalOutcome<Score>;
  durationMs: number;
  cost?: number | undefined;
  reporterErrors: unknown[];
};

export type AnyEvalMetric = EvalMetric<never, never, unknown, never, string>;

export type EvalMetricScore<Metric> = Metric extends {
  evaluate(...args: never[]): infer Result;
}
  ? Awaited<Result> extends EvalOutcome<infer Score>
    ? Score
    : never
  : never;

export type EvalMetricResultFor<Metric> = Metric extends { name: infer Name extends string }
  ? EvalMetricResult<EvalMetricScore<Metric>, Name>
  : never;

export type EvalScoreMap<Metrics extends readonly AnyEvalMetric[]> = {
  [Metric in Metrics[number] as Metric["name"]]: EvalOutcome<EvalMetricScore<Metric>>;
};

export type EvalCaseResult<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly AnyEvalMetric[] = readonly AnyEvalMetric[],
> = {
  case: EvalCase<Input, Expected>;
  outcome: EvalOutcomeStatus;
  targetStatus: "succeeded" | "failed";
  output?: Output | undefined;
  targetError?: unknown;
  targetDurationMs: number;
  durationMs: number;
  metrics: Array<EvalMetricResultFor<Metrics[number]>>;
  scores: EvalScoreMap<Metrics>;
  usage: EvalUsageSummary;
  cost?: EvalCostSummary | undefined;
};

export type EvalSuiteResult<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly AnyEvalMetric[] = readonly AnyEvalMetric[],
> = {
  name: string;
  run: EvalRunContext & { completedAt: string };
  results: Array<EvalCaseResult<Input, Output, Expected, Metrics>>;
  metrics: EvalTotals;
  cases: EvalTotals;
  usage: EvalUsageSummary;
  cost?: EvalCostSummary | undefined;
  durationMs: number;
  reporterErrors: unknown[];
};

export type EvalMetricDescriptor<Score = unknown, Name extends string = string> = Omit<
  EvalMetric<never, never, Score, never, Name>,
  "evaluate"
> & {
  evaluate?: EvalMetric<never, never, Score, never, Name>["evaluate"];
};

export type EvalReportArgs<Input, Output, Score = unknown, Expected = unknown> = {
  run?: EvalRunContext | undefined;
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  targetStatus?: "succeeded" | "failed" | undefined;
  trace?: EvalTraceRef | undefined;
  metric: EvalMetricDescriptor<Score>;
  outcome: EvalOutcome<Score>;
};

export type EvalRunStartArgs = {
  run: EvalRunContext;
  suiteName: string;
  caseCount: number;
  metricNames: string[];
};

export type EvalRunEndArgs = EvalRunStartArgs & {
  status: "completed" | "failed";
  completedAt: string;
  durationMs: number;
  metrics?: EvalTotals | undefined;
  cases?: EvalTotals | undefined;
  usage?: EvalUsageSummary | undefined;
  cost?: EvalCostSummary | undefined;
  error?: unknown;
};

export type EvalTraceSelectorArgs<Input, Output, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  targetStatus?: "succeeded" | "failed" | undefined;
};

export type EvalTraceSelector<Input, Output, Expected = unknown> = (
  args: EvalTraceSelectorArgs<Input, Output, Expected>,
) => EvalTraceRef | undefined | Promise<EvalTraceRef | undefined>;

export type EvalReporter<in Input = unknown, in Output = unknown, in Expected = unknown> = {
  onRunStart?(args: EvalRunStartArgs): void | Promise<void>;
  report(args: EvalReportArgs<Input, Output, unknown, Expected>): void | Promise<void>;
  onRunEnd?(args: EvalRunEndArgs): void | Promise<void>;
};

export type EvalTargetUsageSelector<Input, Output, Expected = unknown> = (
  args: EvalMetricArgs<Input, Output, Expected>,
) => Usage | undefined | Promise<Usage | undefined>;

export type EvalCostCalculatorArgs<Input, Output, Expected = unknown> =
  | {
      kind: "target";
      suiteName: string;
      case: EvalCase<Input, Expected>;
      output: Output;
      usage: Usage;
    }
  | {
      kind: "evaluation";
      suiteName: string;
      case: EvalCase<Input, Expected>;
      output: Output;
      metric: EvalMetric<Input, Output, unknown, Expected>;
      usage: Usage;
    };

export type EvalCostOptions<Input, Output, Expected = unknown> = {
  currency: string;
  calculate(args: EvalCostCalculatorArgs<Input, Output, Expected>): number | Promise<number>;
};

type EvalCaseLike = EvalCase<unknown, unknown>;

type EvalMetricRequirements<Metric> =
  Metric extends EvalMetric<
    infer _Input,
    infer _Output,
    infer _Score,
    infer _Expected,
    infer _Name,
    infer Requirements
  >
    ? Requirements
    : Record<never, never>;

type RequiredExpected<Metrics extends readonly EvalMetric<never, never>[]> = Extract<
  EvalMetricRequirements<Metrics[number]>,
  { expected: unknown }
>;

type RequiredContext<Metrics extends readonly EvalMetric<never, never>[]> = Extract<
  EvalMetricRequirements<Metrics[number]>,
  { context: string[] }
>;

type RequiredRetrievalContext<Metrics extends readonly EvalMetric<never, never>[]> = Extract<
  EvalMetricRequirements<Metrics[number]>,
  { retrievalContext: string[] }
>;

type EvalCaseFieldsForMetrics<Metrics extends readonly EvalMetric<never, never>[]> = ([
  RequiredExpected<Metrics>,
] extends [never]
  ? Record<never, never>
  : { expected: RequiredExpected<Metrics>["expected"] }) &
  ([RequiredContext<Metrics>] extends [never] ? Record<never, never> : { context: string[] }) &
  ([RequiredRetrievalContext<Metrics>] extends [never]
    ? Record<never, never>
    : { retrievalContext: string[] });

export type EvalCasesForMetrics<
  Cases extends readonly EvalCaseLike[],
  Metrics extends readonly EvalMetric<never, never>[],
> = {
  readonly [Index in keyof Cases]: Cases[Index] extends EvalCaseLike
    ? Cases[Index] & EvalCaseFieldsForMetrics<Metrics>
    : Cases[Index];
};

export type EvalShard = {
  index: number;
  count: number;
};

export type EvalProgressEvent<Input, Output, Expected = unknown> =
  | {
      type: "case-start";
      suiteName: string;
      case: EvalCase<Input, Expected>;
      completedCases: number;
      totalCases: number;
    }
  | {
      type: "target-complete";
      suiteName: string;
      case: EvalCase<Input, Expected>;
      targetStatus: "succeeded" | "failed";
      output?: Output | undefined;
      error?: unknown;
      durationMs: number;
      completedCases: number;
      totalCases: number;
    }
  | {
      type: "metric-complete";
      suiteName: string;
      case: EvalCase<Input, Expected>;
      metricName: string;
      outcome: EvalOutcome<unknown>;
      durationMs: number;
      completedCases: number;
      totalCases: number;
    }
  | {
      type: "case-complete";
      suiteName: string;
      result: EvalCaseResult<Input, Output, Expected>;
      completedCases: number;
      totalCases: number;
    };

export type RunEvalSuiteOptions<
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
> = {
  name: string;
  run?: EvalRunOptions | undefined;
  cases: readonly EvalCase<Input, Expected>[] &
    EvalCasesForMetrics<readonly EvalCase<Input, Expected>[], Metrics>;
  target: EvalTarget<Input, Output, Expected>;
  metrics: Metrics;
  concurrency?: number | undefined;
  targetConcurrency?: number | undefined;
  metricConcurrency?: number | undefined;
  caseTimeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  failFast?: boolean | undefined;
  caseIds?: readonly string[] | undefined;
  caseFilter?(testCase: EvalCase<Input, Expected>, index: number): boolean;
  shard?: EvalShard | undefined;
  onProgress?(event: EvalProgressEvent<Input, Output, Expected>): void | Promise<void>;
  trace?: EvalTraceSelector<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>> | undefined;
  reporters?:
    | readonly EvalReporter<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>>[]
    | undefined;
  reporterErrorPolicy?: EvalReporterErrorPolicy | undefined;
  targetUsage?:
    | EvalTargetUsageSelector<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>>
    | undefined;
  cost?: EvalCostOptions<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>> | undefined;
};

export type ValueSelector<Input, Output, Expected, Value> = (
  args: EvalMetricArgs<Input, Output, Expected>,
) => Value | Promise<Value>;

export type SelectorOrValue<Input, Output, Expected, Value> =
  | Value
  | ValueSelector<Input, Output, Expected, Value>;
