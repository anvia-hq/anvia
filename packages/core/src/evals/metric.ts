import type { EvalMetric } from "./types";

export function defineMetric<Input, Output, Score, Expected>(
  metric: EvalMetric<Input, Output, Score, Expected>,
): EvalMetric<Input, Output, Score, Expected> {
  return metric;
}
