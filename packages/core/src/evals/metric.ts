import type { EvalMetric } from "./types";

export function defineMetric<Input, Output, Score, Expected, const Name extends string = string>(
  metric: EvalMetric<Input, Output, Score, Expected, Name>,
): EvalMetric<Input, Output, Score, Expected, Name> {
  return metric;
}
