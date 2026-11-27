import { z } from "zod";
import type { CompletionModel } from "../completion";
import { cosineSimilarity, type EmbeddingModel, embedText } from "../embeddings";
import { extract } from "../extractor";
import { throwIfAborted } from "../internal/abort";
import type { ZodSchema } from "../schema";
import { evalValuesEqual, formatValue, readModelIdentity } from "./format";
import { validateOptionalTemperature } from "./judge";
import { EvalOutcome } from "./outcome";
import { resolveActual, resolveActualText, resolveExpected, resolveJudgePrompt } from "./selectors";
import type {
  EvalCaseRequirements,
  EvalMetadata,
  EvalMetric,
  EvalMetricArgs,
  SelectorOrValue,
  ValueSelector,
} from "./types";

export type ExactMatchOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  trim?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, unknown> | undefined;
};

export function exactMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ExactMatchOptions<Input, Output, Expected> & {
    expected: Exclude<ExactMatchOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function exactMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<ExactMatchOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: unknown }>;
export function exactMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ExactMatchOptions<Input, Output, Expected> & { name?: Name | undefined } = {},
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const caseSensitive = options.caseSensitive ?? true;
  const trim = options.trim ?? false;
  return {
    name: (options.name ?? "exact_match") as Name,
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

      const passed =
        typeof actual === "string" && typeof expected === "string"
          ? normalizeText(actual, caseSensitive, trim) ===
            normalizeText(expected, caseSensitive, trim)
          : evalValuesEqual(actual, expected);
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Expected ${formatValue(expected)}.` });
    },
  };
}

export type ContainsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string | RegExp> | undefined;
};

export function contains<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: string | RegExp,
  options?: Omit<ContainsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function contains<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ContainsOptions<Input, Output, Expected> & {
    expected: Exclude<ContainsOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function contains<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<ContainsOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: string | RegExp }>;
export function contains<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | string
    | RegExp
    | (ContainsOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<ContainsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: ContainsOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrExpected === "string" || optionsOrExpected instanceof RegExp
      ? { ...extraOptions, expected: optionsOrExpected }
      : optionsOrExpected;
  const caseSensitive = options.caseSensitive ?? true;
  return {
    name: (options.name ?? "contains") as Name,
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

      const passed = textExpectationMatches(expected, actual, caseSensitive);
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

export function notContains<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: string | RegExp,
  options?: Omit<NotContainsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function notContains<Input, Output, Expected = unknown, const Name extends string = string>(
  options: NotContainsOptions<Input, Output, Expected> & {
    expected: Exclude<NotContainsOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function notContains<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<NotContainsOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: string | RegExp }>;
export function notContains<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | string
    | RegExp
    | (NotContainsOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<NotContainsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: NotContainsOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrExpected === "string" || optionsOrExpected instanceof RegExp
      ? { ...extraOptions, expected: optionsOrExpected }
      : optionsOrExpected;
  const caseSensitive = options.caseSensitive ?? true;
  return {
    name: (options.name ?? "not_contains") as Name,
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

      const found = textExpectationMatches(expected, actual, caseSensitive);
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
  caseSensitive?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, ReadonlyArray<string | RegExp>> | undefined;
};

export type ContainsAllOptions<Input, Output, Expected = unknown> = ContainsListOptions<
  Input,
  Output,
  Expected
>;

export function containsAll<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: ReadonlyArray<string | RegExp>,
  options?: Omit<ContainsAllOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function containsAll<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ContainsAllOptions<Input, Output, Expected> & {
    expected: Exclude<ContainsAllOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function containsAll<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<ContainsAllOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: ReadonlyArray<string | RegExp> }>;
export function containsAll<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | ReadonlyArray<string | RegExp>
    | (ContainsAllOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<ContainsAllOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: ContainsAllOptions<Input, Output, Expected> & { name?: Name | undefined } =
    Array.isArray(optionsOrExpected)
      ? { ...extraOptions, expected: optionsOrExpected }
      : (optionsOrExpected as ContainsAllOptions<Input, Output, Expected> & {
          name?: Name | undefined;
        });
  return containsListMetric("contains_all", "all", options);
}

export type ContainsAnyOptions<Input, Output, Expected = unknown> = ContainsListOptions<
  Input,
  Output,
  Expected
>;

export function containsAny<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: ReadonlyArray<string | RegExp>,
  options?: Omit<ContainsAnyOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function containsAny<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ContainsAnyOptions<Input, Output, Expected> & {
    expected: Exclude<ContainsAnyOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function containsAny<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<ContainsAnyOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: ReadonlyArray<string | RegExp> }>;
export function containsAny<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | ReadonlyArray<string | RegExp>
    | (ContainsAnyOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<ContainsAnyOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: ContainsAnyOptions<Input, Output, Expected> & { name?: Name | undefined } =
    Array.isArray(optionsOrExpected)
      ? { ...extraOptions, expected: optionsOrExpected }
      : (optionsOrExpected as ContainsAnyOptions<Input, Output, Expected> & {
          name?: Name | undefined;
        });
  return containsListMetric("contains_any", "any", options);
}

function containsListMetric<Input, Output, Expected, const Name extends string>(
  defaultName: string,
  mode: "all" | "any",
  options: ContainsListOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const caseSensitive = options.caseSensitive ?? true;
  return {
    name: (options.name ?? defaultName) as Name,
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

      const matches = expected.map((value) => textExpectationMatches(value, actual, caseSensitive));
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

export function matches<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: RegExp,
  options?: Omit<MatchesOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function matches<Input, Output, Expected = unknown, const Name extends string = string>(
  options: MatchesOptions<Input, Output, Expected> & {
    expected: Exclude<MatchesOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function matches<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<MatchesOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: RegExp }>;
export function matches<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | RegExp
    | (MatchesOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<MatchesOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: MatchesOptions<Input, Output, Expected> & { name?: Name | undefined } =
    optionsOrExpected instanceof RegExp
      ? { ...extraOptions, expected: optionsOrExpected }
      : optionsOrExpected;
  return regexMetric("matches", false, options);
}

export type DoesNotMatchOptions<Input, Output, Expected = unknown> = MatchesOptions<
  Input,
  Output,
  Expected
>;

export function doesNotMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  expected: RegExp,
  options?: Omit<DoesNotMatchOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function doesNotMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  options: DoesNotMatchOptions<Input, Output, Expected> & {
    expected: Exclude<DoesNotMatchOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function doesNotMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  options?: Omit<DoesNotMatchOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, { expected: RegExp }>;
export function doesNotMatch<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrExpected:
    | RegExp
    | (DoesNotMatchOptions<Input, Output, Expected> & { name?: Name | undefined }) = {},
  extraOptions?: Omit<DoesNotMatchOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name, EvalCaseRequirements> {
  const options: DoesNotMatchOptions<Input, Output, Expected> & { name?: Name | undefined } =
    optionsOrExpected instanceof RegExp
      ? { ...extraOptions, expected: optionsOrExpected }
      : optionsOrExpected;
  return regexMetric("does_not_match", true, options);
}

function regexMetric<Input, Output, Expected, const Name extends string>(
  defaultName: string,
  negate: boolean,
  options: MatchesOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  return {
    name: (options.name ?? defaultName) as Name,
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

export function maxLength<Input, Output, Expected = unknown, const Name extends string = string>(
  max: number,
  options?: Omit<MaxLengthOptions<Input, Output, Expected>, "max"> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function maxLength<Input, Output, Expected = unknown, const Name extends string = string>(
  options: MaxLengthOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function maxLength<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrMax: number | (MaxLengthOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<MaxLengthOptions<Input, Output, Expected>, "max"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: MaxLengthOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrMax === "number" ? { ...extraOptions, max: optionsOrMax } : optionsOrMax;
  return {
    name: (options.name ?? "max_length") as Name,
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

export type NotBlankOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
};

/** Checks that the resolved output text contains at least one non-whitespace character. */
export function notBlank<Input, Output, Expected = unknown, const Name extends string = string>(
  options: NotBlankOptions<Input, Output, Expected> & { name?: Name | undefined } = {},
): EvalMetric<Input, Output, boolean, Expected, Name> {
  return {
    name: (options.name ?? "not_blank") as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      return actual.trim().length > 0
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: "Output was blank." });
    },
  };
}

export type RequiredFieldsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected: SelectorOrValue<Input, Output, Expected, readonly string[]>;
};

export function requiredFields<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  expected: readonly string[],
  options?: Omit<RequiredFieldsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function requiredFields<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: RequiredFieldsOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function requiredFields<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  optionsOrExpected:
    | readonly string[]
    | (RequiredFieldsOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<RequiredFieldsOptions<Input, Output, Expected>, "expected"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: RequiredFieldsOptions<Input, Output, Expected> & { name?: Name | undefined } =
    Array.isArray(optionsOrExpected)
      ? { ...extraOptions, expected: optionsOrExpected }
      : (optionsOrExpected as RequiredFieldsOptions<Input, Output, Expected> & {
          name?: Name | undefined;
        });
  return {
    name: (options.name ?? "required_fields") as Name,
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

export type SchemaMatchOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  schema: ZodSchema<SchemaOutput>;
  parseJson?: boolean | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
};

/** Validates structured output directly against a Zod schema, optionally parsing JSON strings. */
export function schemaMatch<
  Input,
  Output,
  SchemaOutput,
  Expected = unknown,
  const Name extends string = string,
>(
  schema: ZodSchema<SchemaOutput>,
  options?: Omit<SchemaMatchOptions<Input, Output, SchemaOutput, Expected>, "schema"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function schemaMatch<
  Input,
  Output,
  SchemaOutput,
  Expected = unknown,
  const Name extends string = string,
>(
  options: SchemaMatchOptions<Input, Output, SchemaOutput, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function schemaMatch<
  Input,
  Output,
  SchemaOutput,
  Expected = unknown,
  const Name extends string = string,
>(
  optionsOrSchema:
    | ZodSchema<SchemaOutput>
    | (SchemaMatchOptions<Input, Output, SchemaOutput, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<SchemaMatchOptions<Input, Output, SchemaOutput, Expected>, "schema"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: SchemaMatchOptions<Input, Output, SchemaOutput, Expected> & {
    name?: Name | undefined;
  } =
    "safeParse" in optionsOrSchema ? { ...extraOptions, schema: optionsOrSchema } : optionsOrSchema;
  return {
    name: (options.name ?? "schema_match") as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      let value = await resolveActual(options.actual, args);

      if (options.parseJson === true && typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return EvalOutcome.fail(false, { comment: `Invalid JSON: ${message}` });
        }
      }

      const parsed = options.schema.safeParse(value);
      return parsed.success
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: z.prettifyError(parsed.error) });
    },
  };
}

export type PredicateCheckResult =
  | boolean
  | {
      pass: boolean;
      comment?: string | undefined;
    };

export type PredicateOptions = {
  required?: boolean | undefined;
  comment?: string | undefined;
  metadata?: EvalMetadata | undefined;
};

/** Builds a concise boolean custom metric from a predicate function. */
export function predicate<Input, Output, Expected = unknown, const Name extends string = string>(
  name: Name,
  check: (
    args: EvalMetricArgs<Input, Output, Expected>,
  ) => PredicateCheckResult | Promise<PredicateCheckResult>,
  options: PredicateOptions = {},
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const metric: EvalMetric<Input, Output, boolean, Expected, Name> = {
    name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const result = await check(args);

      if (typeof result === "boolean") {
        return result
          ? EvalOutcome.pass(true)
          : EvalOutcome.fail(
              false,
              options.comment === undefined ? {} : { comment: options.comment },
            );
      }

      const comment = result.comment ?? options.comment;
      return result.pass
        ? EvalOutcome.pass(true, comment === undefined ? {} : { comment })
        : EvalOutcome.fail(false, comment === undefined ? {} : { comment });
    },
  };

  if (options.metadata !== undefined) {
    metric.metadata = options.metadata;
  }

  return metric;
}

function normalizeText(value: string, caseSensitive: boolean, trim: boolean): string {
  const trimmed = trim ? value.trim() : value;
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function regexMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

function textExpectationMatches(
  expected: string | RegExp,
  actual: string,
  caseSensitive = true,
): boolean {
  if (expected instanceof RegExp) return regexMatches(expected, actual);

  return caseSensitive
    ? actual.includes(expected)
    : actual.toLowerCase().includes(expected.toLowerCase());
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

export function semanticSimilarity<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: SemanticSimilarityOptions<Input, Output, Expected> & {
    expected: Exclude<SemanticSimilarityOptions<Input, Output, Expected>["expected"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name>;
export function semanticSimilarity<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: Omit<SemanticSimilarityOptions<Input, Output, Expected>, "expected"> & {
    expected?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name, { expected: string }>;
export function semanticSimilarity<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: SemanticSimilarityOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name, EvalCaseRequirements> {
  const threshold = unitInterval(options.threshold, "semanticSimilarity threshold");
  const modelIdentity = readModelIdentity(options.model);
  const metric: EvalMetric<Input, Output, number, Expected, Name, EvalCaseRequirements> = {
    name: (options.name ?? "semantic_similarity") as Name,
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "higher_is_better",
    threshold,
    async evaluate(args) {
      throwIfAborted(args.signal);
      const actual = await resolveActualText(options.actual, args);
      throwIfAborted(args.signal);
      const expected = await resolveExpected(options.expected, args);

      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for semantic similarity.");
      }

      if (typeof expected !== "string") {
        return EvalOutcome.invalid("Semantic similarity expected value must be a string.");
      }

      throwIfAborted(args.signal);
      const [{ embedding: actualEmbedding }, { embedding: expectedEmbedding }] = await Promise.all([
        embedText({ model: options.model, text: actual, abortSignal: args.signal }),
        embedText({ model: options.model, text: expected, abortSignal: args.signal }),
      ]);
      throwIfAborted(args.signal);
      const score = cosineSimilarity(actualEmbedding.vector, expectedEmbedding.vector);
      return score >= threshold
        ? EvalOutcome.pass(score)
        : EvalOutcome.fail(score, { comment: `Similarity below threshold ${threshold}.` });
    },
  };

  if (modelIdentity !== undefined) metric.model = modelIdentity;

  return metric;
}

export type LlmJudgeOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  schema: ZodSchema<SchemaOutput>;
  passes(value: SchemaOutput): boolean;
  comment?: ((value: SchemaOutput) => string | undefined) | undefined;
  instructions?: string | undefined;
  retries?: number | undefined;
  temperature?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmJudge<
  Input,
  Output,
  SchemaOutput,
  Expected = unknown,
  const Name extends string = string,
>(
  options: LlmJudgeOptions<Input, Output, SchemaOutput, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, SchemaOutput, Expected, Name> {
  const retries = extractionRetries(options.retries);
  const temperature = validateOptionalTemperature(options.temperature);
  const modelIdentity = readModelIdentity(options.model);
  const metric: EvalMetric<Input, Output, SchemaOutput, Expected, Name> = {
    name: (options.name ?? "llm_judge") as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    projectScore: (value) => options.passes(value),
    async evaluate(args) {
      try {
        throwIfAborted(args.signal);
        const result = await extract({
          model: options.model,
          outputSchema: options.schema,
          abortSignal: args.signal,
          instructions:
            options.instructions ??
            "Judge the eval case by the requested schema. Submit the judgment using the schema.",
          text: await resolveJudgePrompt(options.prompt, args),
          temperature,
          retries,
        });
        throwIfAborted(args.signal);
        const comment = resolveJudgeComment(options.comment, result.output);
        const outcomeOptions =
          comment === undefined ? { usage: result.usage } : { comment, usage: result.usage };
        return options.passes(result.output)
          ? EvalOutcome.pass(result.output, outcomeOptions)
          : EvalOutcome.fail(result.output, outcomeOptions);
      } catch (error) {
        return EvalOutcome.fromError(error);
      }
    },
  };

  if (modelIdentity !== undefined) metric.model = modelIdentity;

  return metric;
}

function resolveJudgeComment<SchemaOutput>(
  selector: ((value: SchemaOutput) => string | undefined) | undefined,
  value: SchemaOutput,
): string | undefined {
  if (selector !== undefined) return selector(value);

  if (typeof value !== "object" || value === null) return undefined;

  for (const key of ["reason", "feedback", "explanation"] as const) {
    if (key in value) {
      const candidate = (value as Record<string, unknown>)[key];

      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
  }

  return undefined;
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
  temperature?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmScore<Input, Output, Expected = unknown, const Name extends string = string>(
  options: LlmScoreOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, LlmScoreMetricScore, Expected, Name> {
  const criteria = Array.isArray(options.criteria) ? options.criteria.join("\n") : options.criteria;

  if (criteria.trim().length === 0) throw new TypeError("llmScore criteria must not be empty.");

  const threshold = unitInterval(options.threshold, "llmScore threshold");
  const retries = extractionRetries(options.retries);
  const temperature = validateOptionalTemperature(options.temperature);
  const modelIdentity = readModelIdentity(options.model);
  const metric: EvalMetric<Input, Output, LlmScoreMetricScore, Expected, Name> = {
    name: (options.name ?? "llm_score") as Name,
    required: options.required ?? true,
    dataType: "NUMERIC",
    projectScore: (score) => score.score,
    direction: "higher_is_better",
    threshold,
    async evaluate(args) {
      try {
        throwIfAborted(args.signal);
        const result = await extract({
          model: options.model,
          outputSchema: z.object({
            score: z.number(),
            feedback: z.string(),
          }),
          abortSignal: args.signal,
          instructions:
            options.instructions ??
            `Score the eval case against these criteria:\n${criteria}\n\nReturn a score between 0 and 1 and brief feedback.`,
          text: await resolveJudgePrompt(options.prompt, args),
          temperature,
          retries,
        });
        throwIfAborted(args.signal);
        const score = result.output;

        if (score.score < 0 || score.score > 1) {
          return EvalOutcome.invalid(`Score ${score.score} outside valid range [0, 1].`, {
            score,
            usage: result.usage,
          });
        }

        return score.score >= threshold
          ? EvalOutcome.pass(score, { comment: score.feedback, usage: result.usage })
          : EvalOutcome.fail(score, { comment: score.feedback, usage: result.usage });
      } catch (error) {
        return EvalOutcome.fromError(error);
      }
    },
  };

  if (modelIdentity !== undefined) metric.model = modelIdentity;

  return metric;
}

function extractionRetries(retries: number | undefined): { maxAttempts: number } | undefined {
  const retryCount = retries ?? 0;

  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw new RangeError("Eval metric retries must be a non-negative integer.");
  }

  if (retryCount === 0) {
    return undefined;
  }

  return { maxAttempts: retryCount + 1 };
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }

  return value;
}
