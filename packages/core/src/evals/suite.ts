import { predicate, type PredicateCheckResult, type PredicateOptions } from "./metrics";
import type {
  EvalCase,
  EvalCasesForMetrics,
  EvalMetric,
  EvalMetricArgs,
  EvalTarget,
  EvalTargetContext,
  RunEvalSuiteOptions,
} from "./types";

export type { EvalCasesForMetrics } from "./types";

type EvalCaseLike = EvalCase<unknown, unknown>;

export type EvalCasesInput<Cases extends readonly EvalCaseLike[]> = Cases[number]["input"];

type EvalCaseExpected<Case> = Case extends { expected: infer Expected } ? Expected : unknown;

export type EvalCasesExpected<Cases extends readonly EvalCaseLike[]> = EvalCaseExpected<
  Cases[number]
>;

export type DefinedEvalSuite<
  Cases extends readonly EvalCaseLike[],
  Output,
  Metrics extends readonly EvalMetric<
    EvalCasesInput<Cases>,
    Output,
    unknown,
    EvalCasesExpected<Cases>,
    string
  >[],
> = Omit<
  RunEvalSuiteOptions<EvalCasesInput<Cases>, Output, EvalCasesExpected<Cases>, Metrics>,
  "caseIds" | "cases" | "target" | "metrics"
> & {
  cases: Cases & NoInfer<EvalCasesForMetrics<Cases, Metrics>>;
  caseIds?: readonly Cases[number]["id"][] | undefined;
  target: EvalTarget<EvalCasesInput<Cases>, Output, EvalCasesExpected<Cases>>;
  metrics: Metrics;
};

type EvalMetricFactory<Input, Output, Expected = unknown> = {
  defineMetric<const Name extends string = string>(
    metric: EvalMetric<Input, Output, boolean, Expected, Name> & { dataType: "BOOLEAN" },
  ): EvalMetric<Input, Output, boolean, Expected, Name>;
  defineMetric<const Name extends string = string>(
    metric: EvalMetric<Input, Output, number, Expected, Name> & { dataType: "NUMERIC" },
  ): EvalMetric<Input, Output, number, Expected, Name>;
  defineMetric<const Name extends string = string>(
    metric: EvalMetric<Input, Output, string, Expected, Name> & { dataType: "CATEGORICAL" },
  ): EvalMetric<Input, Output, string, Expected, Name>;
  defineMetric<Score, const Name extends string = string>(
    metric: EvalMetric<Input, Output, Score, Expected, Name> & {
      dataType: "BOOLEAN";
      projectScore(score: Score): boolean;
    },
  ): EvalMetric<Input, Output, Score, Expected, Name>;
  defineMetric<Score, const Name extends string = string>(
    metric: EvalMetric<Input, Output, Score, Expected, Name> & {
      dataType: "NUMERIC";
      projectScore(score: Score): number;
    },
  ): EvalMetric<Input, Output, Score, Expected, Name>;
  defineMetric<Score, const Name extends string = string>(
    metric: EvalMetric<Input, Output, Score, Expected, Name> & {
      dataType: "CATEGORICAL";
      projectScore(score: Score): string;
    },
  ): EvalMetric<Input, Output, Score, Expected, Name>;
  defineMetric<Score, const Name extends string = string>(
    metric: EvalMetric<Input, Output, Score, Expected, Name> & { dataType?: undefined },
  ): EvalMetric<Input, Output, Score, Expected, Name>;
  predicate<const Name extends string = string>(
    name: Name,
    check: (
      args: EvalMetricArgs<Input, Output, Expected>,
    ) => PredicateCheckResult | Promise<PredicateCheckResult>,
    options?: PredicateOptions,
  ): EvalMetric<Input, Output, boolean, Expected, Name>;
};

export function defineEvalCases<const Cases extends readonly EvalCaseLike[]>(cases: Cases): Cases {
  return cases;
}

export function createEvalTypes<Input, Output, Expected = unknown>(): EvalMetricFactory<
  Input,
  Output,
  Expected
> {
  return {
    defineMetric(metric: EvalMetric<Input, Output>) {
      return metric;
    },
    predicate(name, check, options) {
      return predicate(name, check, options);
    },
  } as EvalMetricFactory<Input, Output, Expected>;
}

/** @deprecated Use createEvalTypes() when defining typed custom metrics. */
export function defineEvalSuite<Input, Output, Expected = unknown>(): EvalMetricFactory<
  Input,
  Output,
  Expected
>;
export function defineEvalSuite<
  const Cases extends readonly EvalCaseLike[],
  const Target extends (
    input: EvalCasesInput<Cases>,
    testCase: EvalCase<EvalCasesInput<Cases>, EvalCasesExpected<Cases>>,
    context?: EvalTargetContext,
  ) => unknown,
  const Metrics extends readonly EvalMetric<
    EvalCasesInput<Cases>,
    Awaited<ReturnType<Target>>,
    unknown,
    EvalCasesExpected<Cases>,
    string
  >[],
>(
  options: DefinedEvalSuite<Cases, Awaited<ReturnType<Target>>, Metrics> & { target: Target },
): DefinedEvalSuite<Cases, Awaited<ReturnType<Target>>, Metrics> & { target: Target };
export function defineEvalSuite(
  options?: DefinedEvalSuite<
    readonly EvalCaseLike[],
    unknown,
    readonly EvalMetric<unknown, unknown>[]
  >,
):
  | DefinedEvalSuite<readonly EvalCaseLike[], unknown, readonly EvalMetric<unknown, unknown>[]>
  | EvalMetricFactory<unknown, unknown, unknown> {
  if (options !== undefined) return options;

  return createEvalTypes();
}
