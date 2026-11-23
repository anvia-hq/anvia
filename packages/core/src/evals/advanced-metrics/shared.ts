import { z } from "zod";
import type { CompletionModel, JsonObject, JsonValue, Usage } from "../../completion";
import { isJsonValue, Usage as UsageValue } from "../../completion";
import { throwIfAborted } from "../../internal/abort";
import { formatValue } from "../format";
import { evaluationMetadata, runJudge } from "../judge";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "../outcome";
import type { EvalMetric, EvalMetricArgs, SelectorOrValue, ValueSelector } from "../types";

export type Verdict = {
  verdict: "yes" | "no" | "idk";
  reason?: string | undefined;
};

export const statementsSchema = z.object({ statements: z.array(z.string()) });
export const factsSchema = z.object({ facts: z.array(z.string()) });
export const questionsSchema = z.object({ questions: z.array(z.string()) });
export const answersSchema = z.object({ answers: z.array(z.enum(["yes", "no"])) });
export const verdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      verdict: z.enum(["yes", "no", "idk"]),
      reason: z.string().optional(),
    }),
  ),
});
export const binaryVerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      verdict: z.enum(["yes", "no"]),
      reason: z.string(),
    }),
  ),
});
export const binaryVerdictSchema = z.object({
  verdict: z.enum(["yes", "no"]),
  reason: z.string(),
});
export const reasonSchema = z.object({ reason: z.string() });
export const abstentionJudgmentSchema = z.object({
  behavior: z.enum(["abstention", "confident_answer"]),
  grounded: z.boolean(),
  reason: z.string(),
});

export type LlmEvalOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  threshold?: number | undefined;
  strictMode?: boolean | undefined;
  includeReason?: boolean | undefined;
  retries?: number | undefined;
  input?: ValueSelector<Input, Output, Expected, string> | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export type MetricConfig<Name extends string = string> = {
  name: Name;
  threshold: number;
  strictMode: boolean;
  includeReason: boolean;
  retries: number;
  required: boolean;
};

export function numericMetric<Input, Output, Expected, const Name extends string>(
  name: Name,
  config: { threshold: number; required: boolean; strictMode?: boolean | undefined },
  direction: "higher_is_better" | "lower_is_better",
  evaluate: (args: EvalMetricArgs<Input, Output, Expected>) => Promise<EvalOutcomeType<number>>,
): EvalMetric<Input, Output, number, Expected, Name> {
  let threshold = config.threshold;

  if (config.strictMode === true) {
    threshold = direction === "higher_is_better" ? 1 : 0;
  }

  return {
    name,
    required: config.required,
    direction,
    threshold,
    dataType: "NUMERIC",
    async evaluate(args) {
      try {
        throwIfAborted(args.signal);
        const outcome = await evaluate(args);
        throwIfAborted(args.signal);
        return outcome;
      } catch (error) {
        return EvalOutcome.fromError(error);
      }
    },
  };
}

export function metricConfig<const Name extends string>(
  options: {
    name?: string | undefined;
    threshold?: number | undefined;
    strictMode?: boolean | undefined;
    includeReason?: boolean | undefined;
    retries?: number | undefined;
    required?: boolean | undefined;
  },
  defaultName: string,
): MetricConfig<Name> {
  return {
    name: (options.name ?? defaultName) as Name,
    threshold: validateThreshold(options.threshold ?? 0.5),
    strictMode: options.strictMode ?? false,
    includeReason: options.includeReason ?? true,
    retries: validateRetries(options.retries ?? 0),
    required: options.required ?? true,
  };
}

export function higherOutcome(args: {
  score: number;
  threshold: number;
  strictMode: boolean;
  comment?: string | undefined;
  details: JsonObject;
  usage: Usage;
}) {
  let score = args.score;

  if (args.strictMode) {
    score = args.score === 1 ? 1 : 0;
  }

  const threshold = args.strictMode ? 1 : args.threshold;
  const options = {
    comment: args.comment,
    usage: args.usage,
    metadata: evaluationMetadata(
      {
        ...args.details,
        scoreDirection: "higher_is_better",
        threshold,
        strictMode: args.strictMode,
      },
      args.usage,
    ),
  };
  return score >= threshold ? EvalOutcome.pass(score, options) : EvalOutcome.fail(score, options);
}

export function lowerOutcome(args: {
  score: number;
  threshold: number;
  strictMode: boolean;
  comment?: string | undefined;
  details: JsonObject;
  usage: Usage;
}) {
  let score = args.score;

  if (args.strictMode) {
    score = args.score === 0 ? 0 : 1;
  }

  const threshold = args.strictMode ? 0 : args.threshold;
  const options = {
    comment: args.comment,
    usage: args.usage,
    metadata: evaluationMetadata(
      {
        ...args.details,
        scoreDirection: "lower_is_better",
        threshold,
        strictMode: args.strictMode,
      },
      args.usage,
    ),
  };
  return score <= threshold ? EvalOutcome.pass(score, options) : EvalOutcome.fail(score, options);
}

export async function maybeReason(args: {
  model: CompletionModel;
  includeReason: boolean;
  retries: number;
  metric: string;
  score: number;
  evidence: JsonObject;
  abortSignal: AbortSignal;
}): Promise<{ reason?: string | undefined; usage: Usage }> {
  throwIfAborted(args.abortSignal);

  if (!args.includeReason) return { usage: UsageValue.empty() };

  const result = await runJudge({
    model: args.model,
    schema: reasonSchema,
    instructions: `Write a concise final explanation for the ${args.metric} score. Ground it only in the supplied evidence and do not repeat the numeric score.`,
    prompt: jsonPrompt({ score: args.score, evidence: args.evidence }),
    abortSignal: args.abortSignal,
    retries: args.retries,
  });
  return { reason: result.data.reason, usage: result.usage };
}

export async function resolveInput<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  return selector === undefined ? formatValue(args.case.input) : selector(args);
}

export async function resolveStringList<Input, Output, Expected>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, string[]> | undefined,
  fallback: string[] | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
  label: string,
): Promise<string[]> {
  let value: string[] | undefined;

  if (selectorOrValue === undefined) {
    value = fallback;
  } else if (typeof selectorOrValue === "function") {
    value = await (selectorOrValue as ValueSelector<Input, Output, Expected, string[]>)(args);
  } else {
    value = selectorOrValue;
  }

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new TypeError(`${label} must be a non-empty array of strings.`);
  }

  return value;
}

export function truthsExtractionInstructions(limit: number | undefined): string {
  return limit === undefined
    ? "Extract concise, factual, undisputed truths from the supplied source material, ordered by importance. Return them in the facts array."
    : `Extract at most ${limit} concise, factual, undisputed truths from the supplied source material, ordered by importance. Return them in the facts array.`;
}

export function limitValues(values: string[], limit: number | undefined): string[] {
  return limit === undefined ? values : values.slice(0, limit);
}

export function validateThreshold(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Eval metric threshold must be between 0 and 1.");
  }

  return value;
}

export function validateRetries(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("Eval metric retries must be a non-negative integer.");
  }

  return value;
}

export function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}

export function validateOptionalNonNegativeInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;

  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

export function assertSameLength(label: string, inputs: unknown[], outputs: unknown[]): void {
  if (inputs.length !== outputs.length) {
    throw new Error(`${label} count ${outputs.length} did not match input count ${inputs.length}.`);
  }
}

export function serializeVerdicts(verdicts: readonly Verdict[]): JsonObject[] {
  return verdicts.map((verdict) => {
    const serialized: JsonObject = { verdict: verdict.verdict };

    if (verdict.reason !== undefined) serialized.reason = verdict.reason;

    return serialized;
  });
}

export function jsonPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function toJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) {
    throw new TypeError("G-Eval expectedOutput must be a JSON value.");
  }

  return cloneJsonValue(value);
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(cloneJsonValue);

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (item === undefined) {
        throw new TypeError("G-Eval expectedOutput must be a JSON value.");
      }

      return [key, cloneJsonValue(item)];
    }),
  );
}
