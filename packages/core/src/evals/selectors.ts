import { defaultOutputValue, formatValue } from "./format";
import type { EvalMetricArgs, SelectorOrValue, ValueSelector } from "./types";

export function selectPromptOutput(args: EvalMetricArgs<unknown, unknown, unknown>): string {
  if (
    typeof args.output !== "object" ||
    args.output === null ||
    !("output" in args.output) ||
    typeof args.output.output !== "string"
  ) {
    throw new TypeError("selectPromptOutput requires an output object with a string output field.");
  }
  return args.output.output;
}

export async function resolveActual<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, unknown> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<unknown> {
  return selector === undefined ? defaultOutputValue(args.output) : selector(args);
}

export async function resolveActualText<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  const value = selector === undefined ? defaultOutputValue(args.output) : await selector(args);
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function resolveExpected<Input, Output, Expected, Value>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, Value> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<Value | Expected | undefined> {
  if (selectorOrValue === undefined) {
    return args.case.expected;
  }
  return typeof selectorOrValue === "function"
    ? (selectorOrValue as ValueSelector<Input, Output, Expected, Value>)(args)
    : selectorOrValue;
}

export async function resolveJudgePrompt<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  if (selector !== undefined) {
    return selector(args);
  }
  return [
    `Suite: ${args.suiteName}`,
    `Case: ${args.case.id}`,
    `Input: ${formatValue(args.case.input)}`,
    `Expected: ${formatValue(args.case.expected)}`,
    `Output: ${formatValue(defaultOutputValue(args.output))}`,
  ].join("\n\n");
}
