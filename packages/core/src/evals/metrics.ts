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
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, unknown> | undefined;
};

export function exactMatch<Input, Output, Expected = unknown>(
  options: ExactMatchOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "exact_match",
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
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string | RegExp> | undefined;
};

export function contains<Input, Output, Expected = unknown>(
  options: ContainsOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "contains",
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

function regexMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

export type SemanticSimilarityOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
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
    async evaluate(args) {
      try {
        const judgment = await extractor.extract(await resolveJudgePrompt(options.prompt, args));
        return options.passes(judgment) ? EvalOutcome.pass(judgment) : EvalOutcome.fail(judgment);
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
    async evaluate(args) {
      try {
        const score = await extractor.extract(await resolveJudgePrompt(options.prompt, args));
        if (score.score < 0 || score.score > 1) {
          return EvalOutcome.invalid(`Score ${score.score} outside valid range [0, 1].`, {
            score,
          });
        }
        return score.score >= options.threshold
          ? EvalOutcome.pass(score, { comment: score.feedback })
          : EvalOutcome.fail(score, { comment: score.feedback });
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}
