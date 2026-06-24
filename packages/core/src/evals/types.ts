import type { JsonValue } from "../completion";
import type { EvalOutcome } from "./outcome";

export type EvalMetadata = Record<string, JsonValue | undefined>;

export type EvalCase<Input, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected | undefined;
  metadata?: EvalMetadata | undefined;
};

export type EvalTarget<Input, Output, Expected = unknown> = (
  input: Input,
  testCase: EvalCase<Input, Expected>,
) => Output | Promise<Output>;

export type EvalOutcomeStatus = "pass" | "fail" | "invalid";

export type EvalMetricArgs<Input, Output, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output: Output;
};

export type EvalMetric<Input, Output, Score = unknown, Expected = unknown> = {
  name: string;
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
  outcome: EvalOutcome<Score>;
  reporterErrors: unknown[];
};

export type EvalCaseResult<Input, Output, Expected = unknown> = {
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  metrics: EvalMetricResult[];
};

export type EvalSuiteResult<Input, Output, Expected = unknown> = {
  name: string;
  results: Array<EvalCaseResult<Input, Output, Expected>>;
  passed: number;
  failed: number;
  invalid: number;
  durationMs: number;
};

export type EvalReportArgs<Input, Output, Score = unknown, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  metric: EvalMetric<Input, Output, Score, Expected>;
  outcome: EvalOutcome<Score>;
};

export type EvalReporter<Input = unknown, Output = unknown, Expected = unknown> = {
  report(args: EvalReportArgs<Input, Output, unknown, Expected>): void | Promise<void>;
};

export type RunEvalSuiteOptions<Input, Output, Expected = unknown> = {
  name: string;
  cases: Array<EvalCase<Input, Expected>>;
  target: EvalTarget<Input, Output, Expected>;
  metrics: Array<EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>>>;
  concurrency?: number | undefined;
  reporters?: Array<EvalReporter<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>>> | undefined;
  failOnReporterError?: boolean | undefined;
};

export type ValueSelector<Input, Output, Expected, Value> = (
  args: EvalMetricArgs<Input, Output, Expected>,
) => Value | Promise<Value>;

export type SelectorOrValue<Input, Output, Expected, Value> =
  | Value
  | ValueSelector<Input, Output, Expected, Value>;
