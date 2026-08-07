import { z } from "zod";
import type { CompletionModel } from "../completion";
import { cosineSimilarity, type EmbeddingModel, embedText } from "../embeddings";
import { ExtractorBuilder } from "../extractor";
import type { ZodSchema } from "../schema";
import { errorMessage, formatValue, stableComparable } from "./format";
import { EvalOutcome } from "./outcome";
import { resolveActual, resolveActualText, resolveExpected, resolveJudgePrompt } from "./selectors";
import type { EvalMetric, SelectorOrValue, ValueSelector } from "./types";

export type ExactMatchOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, unknown> | undefined;
};

export function exactMatch<Input, Output, Expected = unknown>(
  options: ExactMatchOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "exact_match",
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActual(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for exact match.");
      }
      const passed = stableComparable(actual) === stableComparable(expected);
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Expected ${formatValue(expected)}.` });
    },
  };
}

export type ContainsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string | RegExp> | undefined;
};

export function contains<Input, Output, Expected = unknown>(
  options: ContainsOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "contains",
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for contains.");
      }
      if (typeof expected !== "string" && !(expected instanceof RegExp)) {
        return EvalOutcome.invalid("Contains expected value must be a string or RegExp.");
      }
      const passed =
        expected instanceof RegExp ? regexMatches(expected, actual) : actual.includes(expected);
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Output did not contain ${String(expected)}.` });
    },
  };
}

export type NotContainsOptions<Input, Output, Expected = unknown> = ContainsOptions<
  Input,
  Output,
  Expected
>;

export function notContains<Input, Output, Expected = unknown>(
  options: NotContainsOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "not_contains",
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for notContains.");
      }
      if (typeof expected !== "string" && !(expected instanceof RegExp)) {
        return EvalOutcome.invalid("notContains expected value must be a string or RegExp.");
      }
      const found = textExpectationMatches(expected, actual);
      return found
        ? EvalOutcome.fail(false, {
            comment: `Output contained forbidden value ${String(expected)}.`,
          })
        : EvalOutcome.pass(true);
    },
  };
}

export type ContainsListOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, ReadonlyArray<string | RegExp>> | undefined;
};

export type ContainsAllOptions<Input, Output, Expected = unknown> = ContainsListOptions<
  Input,
  Output,
  Expected
>;

export function containsAll<Input, Output, Expected = unknown>(
  options: ContainsAllOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return containsListMetric("contains_all", "all", options);
}

export type ContainsAnyOptions<Input, Output, Expected = unknown> = ContainsListOptions<
  Input,
  Output,
  Expected
>;

export function containsAny<Input, Output, Expected = unknown>(
  options: ContainsAnyOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return containsListMetric("contains_any", "any", options);
}

function containsListMetric<Input, Output, Expected>(
  defaultName: string,
  mode: "all" | "any",
  options: ContainsListOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? defaultName,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (!Array.isArray(expected) || expected.length === 0) {
        return EvalOutcome.invalid(`${defaultName} expected value must be a non-empty array.`);
      }
      if (expected.some((value) => typeof value !== "string" && !(value instanceof RegExp))) {
        return EvalOutcome.invalid(`${defaultName} expected values must be strings or RegExp.`);
      }
      const matches = expected.map((value) => textExpectationMatches(value, actual));
      const passed = mode === "all" ? matches.every(Boolean) : matches.some(Boolean);
      if (passed) return EvalOutcome.pass(true);
      const missing = expected.filter((_, index) => !matches[index]).map(String);
      const comment =
        mode === "all"
          ? `Output was missing: ${missing.join(", ")}.`
          : `Output matched none of: ${expected.map(String).join(", ")}.`;
      return EvalOutcome.fail(false, { comment });
    },
  };
}

export type MatchesOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, RegExp> | undefined;
};

export function matches<Input, Output, Expected = unknown>(
  options: MatchesOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return regexMetric("matches", false, options);
}

export type DoesNotMatchOptions<Input, Output, Expected = unknown> = MatchesOptions<
  Input,
  Output,
  Expected
>;

export function doesNotMatch<Input, Output, Expected = unknown>(
  options: DoesNotMatchOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return regexMetric("does_not_match", true, options);
}

function regexMetric<Input, Output, Expected>(
  defaultName: string,
  negate: boolean,
  options: MatchesOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? defaultName,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (!(expected instanceof RegExp)) {
        return EvalOutcome.invalid(`${defaultName} expected value must be a RegExp.`);
      }
      const matched = regexMatches(expected, actual);
      const passed = negate ? !matched : matched;
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, {
            comment: negate
              ? `Output matched forbidden pattern ${String(expected)}.`
              : `Output did not match ${String(expected)}.`,
          });
    },
  };
}

export type MaxLengthOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  max: SelectorOrValue<Input, Output, Expected, number>;
};

export function maxLength<Input, Output, Expected = unknown>(
  options: MaxLengthOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "max_length",
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const max = await resolveOption(options.max, args);
      if (!Number.isInteger(max) || max < 0) {
        return EvalOutcome.invalid("maxLength max must be a non-negative integer.");
      }
      const length = Array.from(actual).length;
      return length <= max
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Output length ${length} exceeded maximum ${max}.` });
    },
  };
}

export type RequiredFieldsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected: SelectorOrValue<Input, Output, Expected, readonly string[]>;
};

export function requiredFields<Input, Output, Expected = unknown>(
  options: RequiredFieldsOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "required_fields",
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActual(options.actual, args);
      const expected = await resolveOption(options.expected, args);
      if (
        !Array.isArray(expected) ||
        expected.length === 0 ||
        expected.some((field) => typeof field !== "string" || field.length === 0)
      ) {
        return EvalOutcome.invalid(
          "requiredFields expected value must be a non-empty string array.",
        );
      }
      if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
        return EvalOutcome.invalid("requiredFields actual value must be an object.");
      }
      const missing = expected.filter((field) => !Object.hasOwn(actual, field));
      return missing.length === 0
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Missing required fields: ${missing.join(", ")}.` });
    },
  };
}

function regexMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

function textExpectationMatches(expected: string | RegExp, actual: string): boolean {
  return expected instanceof RegExp ? regexMatches(expected, actual) : actual.includes(expected);
}

async function resolveOption<Input, Output, Expected, Value>(
  value: SelectorOrValue<Input, Output, Expected, Value>,
  args: Parameters<ValueSelector<Input, Output, Expected, Value>>[0],
): Promise<Value> {
  return typeof value === "function"
    ? (value as ValueSelector<Input, Output, Expected, Value>)(args)
    : value;
}

export type SemanticSimilarityOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: EmbeddingModel;
  threshold: number;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string> | undefined;
};

export function semanticSimilarity<Input, Output, Expected = unknown>(
  options: SemanticSimilarityOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  return {
    name: options.name ?? "semantic_similarity",
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "higher_is_better",
    threshold: options.threshold,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for semantic similarity.");
      }
      if (typeof expected !== "string") {
        return EvalOutcome.invalid("Semantic similarity expected value must be a string.");
      }
      const [actualEmbedding, expectedEmbedding] = await Promise.all([
        embedText(options.model, actual),
        embedText(options.model, expected),
      ]);
      const score = cosineSimilarity(actualEmbedding.vector, expectedEmbedding.vector);
      return score >= options.threshold
        ? EvalOutcome.pass(score)
        : EvalOutcome.fail(score, { comment: `Similarity below threshold ${options.threshold}.` });
    },
  };
}

export type LlmJudgeOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  schema: ZodSchema<SchemaOutput>;
  passes(value: SchemaOutput): boolean;
  instructions?: string | undefined;
  retries?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmJudge<Input, Output, SchemaOutput, Expected = unknown>(
  options: LlmJudgeOptions<Input, Output, SchemaOutput, Expected>,
): EvalMetric<Input, Output, SchemaOutput, Expected> {
  const extractor = new ExtractorBuilder(options.model, options.schema)
    .instructions(
      options.instructions ??
        "Judge the eval case by the requested schema. Submit the judgment using the schema.",
    )
    .retries(options.retries ?? 0)
    .build();

  return {
    name: options.name ?? "llm_judge",
    required: options.required ?? true,
    async evaluate(args) {
      try {
        const result = await extractor.extractWithUsage(
          await resolveJudgePrompt(options.prompt, args),
        );
        return options.passes(result.data)
          ? EvalOutcome.pass(result.data, { usage: result.usage })
          : EvalOutcome.fail(result.data, { usage: result.usage });
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}

export type LlmScoreMetricScore = {
  score: number;
  feedback: string;
};

export type LlmScoreOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  threshold: number;
  criteria: string | string[];
  instructions?: string | undefined;
  retries?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmScore<Input, Output, Expected = unknown>(
  options: LlmScoreOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, LlmScoreMetricScore, Expected> {
  const criteria = Array.isArray(options.criteria) ? options.criteria.join("\n") : options.criteria;
  const extractor = new ExtractorBuilder(
    options.model,
    z.object({
      score: z.number(),
      feedback: z.string(),
    }),
  )
    .instructions(
      options.instructions ??
        `Score the eval case against these criteria:\n${criteria}\n\nReturn a score between 0 and 1 and brief feedback.`,
    )
    .retries(options.retries ?? 0)
    .build();

  return {
    name: options.name ?? "llm_score",
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "higher_is_better",
    threshold: options.threshold,
    async evaluate(args) {
      try {
        const result = await extractor.extractWithUsage(
          await resolveJudgePrompt(options.prompt, args),
        );
        const score = result.data;
        if (score.score < 0 || score.score > 1) {
          return EvalOutcome.invalid(`Score ${score.score} outside valid range [0, 1].`, {
            score,
            usage: result.usage,
          });
        }
        return score.score >= options.threshold
          ? EvalOutcome.pass(score, { comment: score.feedback, usage: result.usage })
          : EvalOutcome.fail(score, { comment: score.feedback, usage: result.usage });
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}
