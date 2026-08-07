import type { JsonValue, Usage } from "../completion";
import type { EvalOutcome } from "./outcome";

export type EvalMetadata = Record<string, JsonValue | undefined>;

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
  traceId: string;
  observationId?: string | undefined;
  responseId?: string | undefined;
};

export type EvalTarget<Input, Output, Expected = unknown> = (
  input: Input,
  testCase: EvalCase<Input, Expected>,
) => Output | Promise<Output>;

export type EvalOutcomeStatus = "pass" | "fail" | "invalid";

export type EvalScoreDirection = "higher_is_better" | "lower_is_better";

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
};

export type EvalMetric<Input, Output, Score = unknown, Expected = unknown> = {
  name: string;
  required?: boolean | undefined;
  direction?: EvalScoreDirection | undefined;
  threshold?: number | undefined;
  dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN" | undefined;
  scoreConfigId?: string | undefined;
  configId?: string | undefined;
  metadata?: EvalMetadata | undefined;
  evaluate(
    args: EvalMetricArgs<Input, Output, Expected>,
  ): EvalOutcome<Score> | Promise<EvalOutcome<Score>>;
};

export type EvalMetricResult<Score = unknown> = {
  metricName: string;
  required: boolean;
  direction?: EvalScoreDirection | undefined;
  threshold?: number | undefined;
  outcome: EvalOutcome<Score>;
  reporterErrors: unknown[];
};

export type EvalCaseResult<Input, Output, Expected = unknown> = {
  case: EvalCase<Input, Expected>;
  outcome: EvalOutcomeStatus;
  output?: Output | undefined;
  targetError?: unknown;
  metrics: EvalMetricResult[];
};

export type EvalSuiteResult<Input, Output, Expected = unknown> = {
  name: string;
  run: EvalRunContext & { completedAt: string };
  results: Array<EvalCaseResult<Input, Output, Expected>>;
  metrics: EvalTotals;
  cases: EvalTotals;
  usage: EvalUsageSummary;
  cost?: EvalCostSummary | undefined;
  durationMs: number;
  reporterErrors: unknown[];
};

export type EvalReportArgs<Input, Output, Score = unknown, Expected = unknown> = {
  run?: EvalRunContext | undefined;
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  trace?: EvalTraceRef | undefined;
  metric: EvalMetric<Input, Output, Score, Expected>;
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
};

export type EvalTraceSelector<Input, Output, Expected = unknown> = (
  args: EvalTraceSelectorArgs<Input, Output, Expected>,
) => EvalTraceRef | undefined | Promise<EvalTraceRef | undefined>;

export type EvalReporter<Input = unknown, Output = unknown, Expected = unknown> = {
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

export type RunEvalSuiteOptions<Input, Output, Expected = unknown> = {
  name: string;
  run?: EvalRunOptions | undefined;
  cases: Array<EvalCase<Input, Expected>>;
  target: EvalTarget<Input, Output, Expected>;
  metrics: Array<EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>>>;
  concurrency?: number | undefined;
  trace?: EvalTraceSelector<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>> | undefined;
  reporters?: Array<EvalReporter<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>>> | undefined;
  failOnReporterError?: boolean | undefined;
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
