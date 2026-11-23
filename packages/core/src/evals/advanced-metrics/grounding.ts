import type { CompletionModel } from "../../completion";
import { throwIfAborted } from "../../internal/abort";
import { readModelIdentity } from "../format";
import { addUsage, evaluationMetadata, runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import { resolveActualText, resolveExpected } from "../selectors";
import type {
  EvalCaseRequirements,
  EvalMetric,
  EvalMetricArgs,
  SelectorOrValue,
  ValueSelector,
} from "../types";
import {
  abstentionJudgmentSchema,
  assertSameLength,
  binaryVerdictsSchema,
  factsSchema,
  higherOutcome,
  type IncludeReasonMode,
  jsonPrompt,
  limitValues,
  type LlmEvalOptions,
  lowerOutcome,
  maybeReason,
  metricConfig,
  numericMetric,
  resolveStringList,
  serializeVerdicts,
  shouldIncludeReason,
  truthsExtractionInstructions,
  validateOptionalNonNegativeInteger,
  validateRetries,
  type Verdict,
  verdictsSchema,
  willPassHigher,
  willPassLower,
} from "./shared";

export type HallucinationOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  context?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
};

export function hallucination<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: HallucinationOptions<Input, Output, Expected> & {
    context: Exclude<HallucinationOptions<Input, Output, Expected>["context"], undefined>;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name>;
export function hallucination<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: Omit<HallucinationOptions<Input, Output, Expected>, "context"> & {
    context?: undefined;
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name, { context: string[] }>;
export function hallucination<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: HallucinationOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name, EvalCaseRequirements> {
  const config = metricConfig<Name>(options, "hallucination");
  return numericMetric(config.name, config, "lower_is_better", async (args) => {
    try {
      const actual = await resolveActualText(options.actual, args);
      const context = await resolveStringList(options.context, args.case.context, args, "context");
      const verdictResult = await runJudge({
        model: options.model,
        schema: binaryVerdictsSchema,
        instructions:
          "Compare the answer with each trusted context. Use yes when the answer is factually aligned with that context and no when it contradicts it. Preserve order and return one verdict per context.",
        prompt: jsonPrompt({ actual, context }),
        abortSignal: args.signal,
        retries: config.retries,
      });
      const verdicts = verdictResult.data.verdicts;
      assertSameLength("hallucination verdicts", context, verdicts);
      const score = verdicts.filter((verdict) => verdict.verdict === "no").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassLower(score, config.threshold, config.strictMode),
        retries: config.retries,
        metric: "hallucination",
        abortSignal: args.signal,
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(verdictResult.usage, reasonResult.usage);
      return lowerOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}

export type FaithfulnessOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  retrievalContext?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
  truthsExtractionLimit?: number | undefined;
  penalizeAmbiguousClaims?: boolean | undefined;
};

export function faithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
  options: FaithfulnessOptions<Input, Output, Expected> & {
    name?: Name | undefined;
    retrievalContext: Exclude<
      FaithfulnessOptions<Input, Output, Expected>["retrievalContext"],
      undefined
    >;
  },
): EvalMetric<Input, Output, number, Expected, Name>;
export function faithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
  options: Omit<FaithfulnessOptions<Input, Output, Expected>, "retrievalContext"> & {
    name?: Name | undefined;
    retrievalContext?: undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name, { retrievalContext: string[] }>;
export function faithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
  options: FaithfulnessOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name, EvalCaseRequirements> {
  const config = metricConfig<Name>(options, "faithfulness");
  const truthsExtractionLimit = validateOptionalNonNegativeInteger(
    options.truthsExtractionLimit,
    "truthsExtractionLimit",
  );
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const actual = await resolveActualText(options.actual, args);
      const retrievalContext = await resolveStringList(
        options.retrievalContext,
        args.case.retrievalContext,
        args,
        "retrievalContext",
      );
      const [truthResult, claimResult] = await Promise.all([
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions: truthsExtractionInstructions(truthsExtractionLimit),
          prompt: jsonPrompt({ retrievalContext }),
          abortSignal: args.signal,
          retries: config.retries,
        }),
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract every concise factual claim made by the answer. Return claims in the facts array and omit opinions or purely stylistic text.",
          prompt: `Answer:\n${actual}`,
          abortSignal: args.signal,
          retries: config.retries,
        }),
      ]);
      const truths = limitValues(truthResult.data.facts, truthsExtractionLimit);
      const claims = claimResult.data.facts;
      let verdicts: Verdict[] = [];
      let usage = addUsage(truthResult.usage, claimResult.usage);

      if (claims.length > 0) {
        const verdictResult = await runJudge({
          model: options.model,
          schema: verdictsSchema,
          instructions:
            "Determine whether each answer claim is supported by the supplied truths. Use yes for supported, no for contradicted or unsupported, and idk for genuinely ambiguous support. Preserve order and return one verdict per claim.",
          prompt: jsonPrompt({ truths, claims }),
          abortSignal: args.signal,
          retries: config.retries,
        });
        verdicts = verdictResult.data.verdicts;
        assertSameLength("faithfulness verdicts", claims, verdicts);
        usage = addUsage(usage, verdictResult.usage);
      }

      const penalizeAmbiguousClaims = options.penalizeAmbiguousClaims ?? false;
      const supported = verdicts.filter(
        (verdict) =>
          verdict.verdict === "yes" || (verdict.verdict === "idk" && !penalizeAmbiguousClaims),
      ).length;
      const score = verdicts.length === 0 ? 1 : supported / verdicts.length;
      const serializedVerdicts = serializeVerdicts(verdicts);
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        metric: "faithfulness",
        abortSignal: args.signal,
        score,
        evidence: { verdicts: serializedVerdicts, penalizeAmbiguousClaims },
      });
      usage = addUsage(usage, reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { truths, claims, verdicts: serializedVerdicts, penalizeAmbiguousClaims },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}

export type AbstentionCategory =
  | "correct_abstention"
  | "unnecessary_abstention"
  | "unsupported_confident_answer"
  | "correct_grounded_answer";

export type AbstentionOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  shouldAbstain: SelectorOrValue<Input, Output, Expected, boolean>;
  context?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  includeReason?: IncludeReasonMode | undefined;
  retries?: number | undefined;
};

export function abstention<Input, Output, Expected = unknown, const Name extends string = string>(
  options: AbstentionOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, AbstentionCategory, Expected, Name> {
  const retries = validateRetries(options.retries ?? 0);
  const includeReason = options.includeReason ?? true;
  const modelIdentity = readModelIdentity(options.model);
  const metric: EvalMetric<Input, Output, AbstentionCategory, Expected, Name> = {
    name: (options.name ?? "abstention") as Name,
    required: options.required ?? true,
    dataType: "CATEGORICAL",
    async evaluate(args) {
      try {
        throwIfAborted(args.signal);
        const actual = await resolveActualText(options.actual, args);
        const shouldAbstain = await resolveExpected(options.shouldAbstain, args);

        if (typeof shouldAbstain !== "boolean") {
          return EvalOutcome.invalid("abstention shouldAbstain must resolve to a boolean.");
        }

        const context = await resolveAbstentionContext(options.context, args);

        if (!shouldAbstain && context.length === 0) {
          return EvalOutcome.invalid(
            "abstention context must be non-empty when shouldAbstain is false.",
          );
        }

        const judgment = await runJudge({
          abortSignal: args.signal,
          model: options.model,
          schema: abstentionJudgmentSchema,
          instructions:
            "Classify whether the answer abstains or gives a confident answer. For a confident answer, grounded is true only when every substantive factual claim is supported by the supplied context. For an abstention, set grounded to false. Return a concise evidence-based reason.",
          prompt: jsonPrompt({ actual, context }),
          retries,
        });
        throwIfAborted(args.signal);
        const category = abstentionCategory(
          shouldAbstain,
          judgment.data.behavior,
          judgment.data.grounded,
        );
        const passed = category === "correct_abstention" || category === "correct_grounded_answer";
        const outcomeOptions = {
          comment: shouldIncludeReason(includeReason, passed) ? judgment.data.reason : undefined,
          metadata: evaluationMetadata(
            {
              behavior: judgment.data.behavior,
              grounded: judgment.data.grounded,
              shouldAbstain,
            },
            judgment.usage,
          ),
          usage: judgment.usage,
        };
        return passed
          ? EvalOutcome.pass(category, outcomeOptions)
          : EvalOutcome.fail(category, outcomeOptions);
      } catch (error) {
        return EvalOutcome.fromError(error);
      }
    },
  };

  if (modelIdentity !== undefined) metric.model = modelIdentity;

  return metric;
}

async function resolveAbstentionContext<Input, Output, Expected>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, string[]> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string[]> {
  let context: string[];

  if (selectorOrValue === undefined) {
    context = args.case.retrievalContext ?? [];
  } else if (typeof selectorOrValue === "function") {
    context = await (selectorOrValue as ValueSelector<Input, Output, Expected, string[]>)(args);
  } else {
    context = selectorOrValue;
  }

  if (!Array.isArray(context) || context.some((value) => typeof value !== "string")) {
    throw new TypeError("abstention context must be an array of strings.");
  }

  return context;
}

function abstentionCategory(
  shouldAbstain: boolean,
  behavior: "abstention" | "confident_answer",
  grounded: boolean,
): AbstentionCategory {
  if (behavior === "abstention") {
    return shouldAbstain ? "correct_abstention" : "unnecessary_abstention";
  }

  if (shouldAbstain || !grounded) return "unsupported_confident_answer";

  return "correct_grounded_answer";
}
