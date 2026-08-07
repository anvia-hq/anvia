import { z } from "zod";
import type { CompletionModel, JsonObject, JsonValue, Message, Usage } from "../completion";
import { Usage as UsageValue } from "../completion";
import { mapWithConcurrency } from "../internal/concurrency";
import type { ZodSchema } from "../schema";
import { errorMessage, formatValue } from "./format";
import { addUsage, evaluationMetadata, type JudgeResult, runJudge } from "./judge";
import { EvalOutcome, type EvalOutcome as EvalOutcomeType } from "./outcome";
import { resolveActualText, resolveExpected } from "./selectors";
import type { EvalMetric, EvalMetricArgs, EvalTurn, SelectorOrValue, ValueSelector } from "./types";

type Verdict = {
  verdict: "yes" | "no" | "idk";
  reason?: string | undefined;
};

const statementsSchema = z.object({ statements: z.array(z.string()) });
const factsSchema = z.object({ facts: z.array(z.string()) });
const questionsSchema = z.object({ questions: z.array(z.string()) });
const answersSchema = z.object({ answers: z.array(z.enum(["yes", "no"])) });
const verdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      verdict: z.enum(["yes", "no", "idk"]),
      reason: z.string().optional(),
    }),
  ),
});
const binaryVerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      verdict: z.enum(["yes", "no"]),
      reason: z.string(),
    }),
  ),
});
const binaryVerdictSchema = z.object({
  verdict: z.enum(["yes", "no"]),
  reason: z.string(),
});
const reasonSchema = z.object({ reason: z.string() });
const abstentionJudgmentSchema = z.object({
  behavior: z.enum(["abstention", "confident_answer"]),
  grounded: z.boolean(),
  reason: z.string(),
});

type LlmEvalOptions<Input, Output, Expected = unknown> = {
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

export type AnswerRelevancyOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
>;

export function answerRelevancy<Input, Output, Expected = unknown>(
  options: AnswerRelevancyOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "answer_relevancy");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const input = await resolveInput(options.input, args);
      const actual = await resolveActualText(options.actual, args);
      const statementResult = await runJudge({
        model: options.model,
        schema: statementsSchema,
        instructions:
          "Break the answer into concise, independently assessable statements. Return every substantive statement using the schema.",
        prompt: `Answer:\n${actual}`,
        retries: config.retries,
      });
      const statements = statementResult.data.statements;
      let verdicts: Verdict[] = [];
      let usage = statementResult.usage;
      if (statements.length > 0) {
        const verdictResult = await runJudge({
          model: options.model,
          schema: verdictsSchema,
          instructions:
            "Classify each answer statement for relevance to the user input. Use yes for relevant, no for irrelevant, and idk only when relevance is genuinely indeterminate. Preserve order and return one verdict per statement.",
          prompt: jsonPrompt({ input, statements }),
          retries: config.retries,
        });
        verdicts = verdictResult.data.verdicts;
        assertSameLength("answer relevancy verdicts", statements, verdicts);
        usage = addUsage(usage, verdictResult.usage);
      }
      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => verdict.verdict !== "no").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "answer relevancy",
        score,
        evidence: { input, verdicts },
      });
      usage = addUsage(usage, reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { statements, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

export type PromptAlignmentOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  promptInstructions: string[];
};

export function promptAlignment<Input, Output, Expected = unknown>(
  options: PromptAlignmentOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  if (options.promptInstructions.length === 0) {
    throw new TypeError("promptAlignment requires at least one prompt instruction.");
  }
  const config = metricConfig(options, "prompt_alignment");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const input = await resolveInput(options.input, args);
      const actual = await resolveActualText(options.actual, args);
      const verdictResult = await runJudge({
        model: options.model,
        schema: binaryVerdictsSchema,
        instructions:
          "Determine whether the answer follows each prompt instruction. Preserve order and return exactly one yes or no verdict per instruction.",
        prompt: jsonPrompt({ input, actual, instructions: options.promptInstructions }),
        retries: config.retries,
      });
      const verdicts = verdictResult.data.verdicts;
      assertSameLength("prompt alignment verdicts", options.promptInstructions, verdicts);
      const score =
        verdicts.filter((verdict) => verdict.verdict === "yes").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "prompt alignment",
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(verdictResult.usage, reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { promptInstructions: options.promptInstructions, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

export type JsonCorrectnessOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  schema: ZodSchema<SchemaOutput>;
  model?: CompletionModel | undefined;
  threshold?: number | undefined;
  strictMode?: boolean | undefined;
  includeReason?: boolean | undefined;
  retries?: number | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function jsonCorrectness<Input, Output, SchemaOutput, Expected = unknown>(
  options: JsonCorrectnessOptions<Input, Output, SchemaOutput, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const threshold = validateThreshold(options.threshold ?? 0.5);
  const retries = validateRetries(options.retries ?? 0);
  const includeReason = options.includeReason ?? true;
  const strictMode = options.strictMode ?? true;
  return numericMetric(
    options.name ?? "json_correctness",
    {
      threshold: strictMode ? 1 : threshold,
      required: options.required ?? true,
    },
    "higher_is_better",
    async (args) => {
      try {
        const actual = await resolveActualText(options.actual, args);
        let parsed: unknown;
        let validationError: string | undefined;
        try {
          parsed = JSON.parse(actual);
          const result = options.schema.safeParse(parsed);
          if (!result.success) {
            validationError = z.prettifyError(result.error);
          }
        } catch (error) {
          validationError = errorMessage(error);
        }
        const score = validationError === undefined ? 1 : 0;
        let comment: string | undefined;
        let usage = UsageValue.empty();
        if (includeReason) {
          if (score === 1) {
            comment = "The generated JSON is syntactically valid and matches the expected schema.";
          } else if (options.model === undefined) {
            comment = validationError;
          } else {
            const reasonResult = await runJudge({
              model: options.model,
              schema: reasonSchema,
              instructions:
                "Briefly explain why the generated JSON does not match the expected schema. Focus on actionable syntax, field, and type problems.",
              prompt: jsonPrompt({ actual, validationError }),
              retries,
            });
            comment = reasonResult.data.reason;
            usage = reasonResult.usage;
          }
        }
        return higherOutcome({
          score,
          threshold,
          strictMode,
          comment,
          details: validationError === undefined ? {} : { validationError },
          usage,
        });
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  );
}

export type HallucinationOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  context?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
};

export function hallucination<Input, Output, Expected = unknown>(
  options: HallucinationOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "hallucination");
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
        retries: config.retries,
      });
      const verdicts = verdictResult.data.verdicts;
      assertSameLength("hallucination verdicts", context, verdicts);
      const score = verdicts.filter((verdict) => verdict.verdict === "no").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "hallucination",
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
      return EvalOutcome.invalid(errorMessage(error));
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

export function faithfulness<Input, Output, Expected = unknown>(
  options: FaithfulnessOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "faithfulness");
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
          retries: config.retries,
        }),
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract every concise factual claim made by the answer. Return claims in the facts array and omit opinions or purely stylistic text.",
          prompt: `Answer:\n${actual}`,
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
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "faithfulness",
        score,
        evidence: { verdicts, penalizeAmbiguousClaims },
      });
      usage = addUsage(usage, reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { truths, claims, verdicts, penalizeAmbiguousClaims },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
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
  includeReason?: boolean | undefined;
  retries?: number | undefined;
};

export function abstention<Input, Output, Expected = unknown>(
  options: AbstentionOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, AbstentionCategory, Expected> {
  const retries = validateRetries(options.retries ?? 0);
  return {
    name: options.name ?? "abstention",
    required: options.required ?? true,
    dataType: "CATEGORICAL",
    async evaluate(args) {
      try {
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
          model: options.model,
          schema: abstentionJudgmentSchema,
          instructions:
            "Classify whether the answer abstains or gives a confident answer. For a confident answer, grounded is true only when every substantive factual claim is supported by the supplied context. For an abstention, set grounded to false. Return a concise evidence-based reason.",
          prompt: jsonPrompt({ actual, context }),
          retries,
        });
        const category = abstentionCategory(
          shouldAbstain,
          judgment.data.behavior,
          judgment.data.grounded,
        );
        const outcomeOptions = {
          comment: options.includeReason === false ? undefined : judgment.data.reason,
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
        return category === "correct_abstention" || category === "correct_grounded_answer"
          ? EvalOutcome.pass(category, outcomeOptions)
          : EvalOutcome.fail(category, outcomeOptions);
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}

async function resolveAbstentionContext<Input, Output, Expected>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, string[]> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string[]> {
  const context =
    selectorOrValue === undefined
      ? (args.case.retrievalContext ?? [])
      : typeof selectorOrValue === "function"
        ? await (selectorOrValue as ValueSelector<Input, Output, Expected, string[]>)(args)
        : selectorOrValue;
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

export type SummarizationOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  assessmentQuestions?: string[] | undefined;
  questionCount?: number | undefined;
  truthsExtractionLimit?: number | undefined;
};

export function summarization<Input, Output, Expected = unknown>(
  options: SummarizationOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "summarization");
  const questionCount = validatePositiveInteger(options.questionCount ?? 5, "questionCount");
  const truthsExtractionLimit = validateOptionalNonNegativeInteger(
    options.truthsExtractionLimit,
    "truthsExtractionLimit",
  );
  const suppliedQuestions =
    options.assessmentQuestions !== undefined && options.assessmentQuestions.length > 0
      ? [...options.assessmentQuestions]
      : undefined;
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const input = await resolveInput(options.input, args);
      const actual = await resolveActualText(options.actual, args);
      const questionPromise: Promise<JudgeResult<{ questions: string[] }>> =
        suppliedQuestions === undefined
          ? runJudge({
              model: options.model,
              schema: questionsSchema,
              instructions: `Generate exactly ${questionCount} important yes-or-no assessment questions whose answers capture the source text's essential information.`,
              prompt: `Source text:\n${input}`,
              retries: config.retries,
            })
          : Promise.resolve({
              data: { questions: suppliedQuestions },
              usage: UsageValue.empty(),
            });
      const [truthResult, claimResult, questionResult] = await Promise.all([
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions: truthsExtractionInstructions(truthsExtractionLimit),
          prompt: `Source text:\n${input}`,
          retries: config.retries,
        }),
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract every concise factual claim made by the summary. Return claims in the facts array.",
          prompt: `Summary:\n${actual}`,
          retries: config.retries,
        }),
        questionPromise,
      ]);
      const truths = limitValues(truthResult.data.facts, truthsExtractionLimit);
      const claims = claimResult.data.facts;
      const questions = questionResult.data.questions;
      if (questions.length === 0) {
        throw new Error("Summarization assessment questions must not be empty.");
      }
      const sourceAnswerPromise = runJudge({
        model: options.model,
        schema: answersSchema,
        instructions:
          "Answer each assessment question using only the supplied text. Return one yes or no answer per question in the same order.",
        prompt: jsonPrompt({ questions, text: input }),
        retries: config.retries,
      });
      const summaryAnswerPromise = runJudge({
        model: options.model,
        schema: answersSchema,
        instructions:
          "Answer each assessment question using only the supplied text. Return one yes or no answer per question in the same order.",
        prompt: jsonPrompt({ questions, text: actual }),
        retries: config.retries,
      });
      const alignmentPromise: Promise<JudgeResult<{ verdicts: Verdict[] }>> =
        claims.length === 0
          ? Promise.resolve({ data: { verdicts: [] }, usage: UsageValue.empty() })
          : runJudge({
              model: options.model,
              schema: verdictsSchema,
              instructions:
                "Determine whether each summary claim is supported by the source truths. Use yes for supported, no for contradicted, and idk for unsupported filler or ambiguity. Preserve order.",
              prompt: jsonPrompt({ truths, claims }),
              retries: config.retries,
            });
      const [sourceAnswerResult, summaryAnswerResult, alignmentResult] = await Promise.all([
        sourceAnswerPromise,
        summaryAnswerPromise,
        alignmentPromise,
      ]);
      assertSameLength("source assessment answers", questions, sourceAnswerResult.data.answers);
      assertSameLength("summary assessment answers", questions, summaryAnswerResult.data.answers);
      assertSameLength("summarization alignment verdicts", claims, alignmentResult.data.verdicts);
      const alignmentVerdicts = alignmentResult.data.verdicts;
      const alignmentScore =
        alignmentVerdicts.length === 0
          ? 0
          : alignmentVerdicts.filter((verdict) => verdict.verdict === "yes").length /
            alignmentVerdicts.length;
      let coverageTotal = 0;
      let coverageMatched = 0;
      const coverageVerdicts = questions.map((question, index) => {
        const originalVerdict = sourceAnswerResult.data.answers[index] as "yes" | "no";
        const summaryVerdict = summaryAnswerResult.data.answers[index] as "yes" | "no";
        if (originalVerdict === "yes") {
          coverageTotal += 1;
          if (summaryVerdict === "yes") coverageMatched += 1;
        }
        return { question, originalVerdict, summaryVerdict };
      });
      const coverageScore = coverageTotal === 0 ? 0 : coverageMatched / coverageTotal;
      const score = Math.min(alignmentScore, coverageScore);
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "summarization",
        score,
        evidence: { alignmentVerdicts, coverageVerdicts, alignmentScore, coverageScore },
      });
      const usage = addUsage(
        truthResult.usage,
        claimResult.usage,
        questionResult.usage,
        sourceAnswerResult.usage,
        summaryAnswerResult.usage,
        alignmentResult.usage,
        reasonResult.usage,
      );
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: {
          truths,
          claims,
          assessmentQuestions: questions,
          alignmentVerdicts,
          coverageVerdicts,
          scoreBreakdown: { alignment: alignmentScore, coverage: coverageScore },
        },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

export type GEvalParameter =
  | "input"
  | "actualOutput"
  | "expectedOutput"
  | "context"
  | "retrievalContext"
  | "metadata";

export type GEvalRubric = {
  scoreRange: readonly [number, number];
  expectedOutcome: string;
};

export type GEvalOptions<Input, Output, Expected = unknown> = Omit<
  LlmEvalOptions<Input, Output, Expected>,
  "name"
> & {
  name: string;
  evaluationParams: GEvalParameter[];
  criteria?: string | undefined;
  evaluationSteps?: string[] | undefined;
  rubric?: GEvalRubric[] | undefined;
  expected?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  context?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
  retrievalContext?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
};

export function gEval<Input, Output, Expected = unknown>(
  options: GEvalOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  if (options.name.trim().length === 0) throw new TypeError("gEval name must not be empty.");
  if (options.evaluationParams.length === 0) {
    throw new TypeError("gEval requires at least one evaluation parameter.");
  }
  if ((options.criteria === undefined) === (options.evaluationSteps === undefined)) {
    throw new TypeError("gEval requires exactly one of criteria or evaluationSteps.");
  }
  if (options.criteria !== undefined && options.criteria.trim().length === 0) {
    throw new TypeError("gEval criteria must not be empty.");
  }
  if (options.evaluationSteps !== undefined && options.evaluationSteps.length === 0) {
    throw new TypeError("gEval evaluationSteps must not be empty.");
  }
  const config = metricConfig(options, options.name);
  const rubric = validateRubric(options.rubric);
  const scoreRange =
    rubric.length === 0
      ? ([0, 10] as const)
      : ([rubric[0]?.scoreRange[0] ?? 0, rubric.at(-1)?.scoreRange[1] ?? 10] as const);
  let generatedStepsPromise: Promise<JudgeResult<{ steps: string[] }>> | undefined;
  let generatedUsageClaimed = false;

  async function resolveSteps(): Promise<{ steps: string[]; usage: Usage }> {
    if (options.evaluationSteps !== undefined) {
      return { steps: options.evaluationSteps, usage: UsageValue.empty() };
    }
    if (generatedStepsPromise === undefined) {
      generatedStepsPromise = runJudge({
        model: options.model,
        schema: z.object({ steps: z.array(z.string()) }),
        instructions:
          "Generate three or four concise evaluation steps from the criteria. Explain how the selected parameters should be judged in relation to one another.",
        prompt: jsonPrompt({ criteria: options.criteria, parameters: options.evaluationParams }),
        retries: config.retries,
      }).catch((error) => {
        generatedStepsPromise = undefined;
        throw error;
      });
    }
    const result = await generatedStepsPromise;
    if (result.data.steps.length === 0) throw new Error("G-Eval generated no evaluation steps.");
    const usage = generatedUsageClaimed ? UsageValue.empty() : result.usage;
    generatedUsageClaimed = true;
    return { steps: result.data.steps, usage };
  }

  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const parameters = await resolveGEvalParameters(options, args);
      const stepsResult = await resolveSteps();
      const scoreResult = await runJudge({
        model: options.model,
        schema: z.object({ score: z.number(), reason: z.string() }),
        instructions: config.strictMode
          ? "Apply the evaluation steps and return score 1 only for complete compliance, otherwise 0. Give a concise evidence-based reason."
          : `Apply the evaluation steps and return an integer score from ${scoreRange[0]} through ${scoreRange[1]}, plus a concise evidence-based reason.`,
        prompt: jsonPrompt({
          evaluationSteps: stepsResult.steps,
          rubric,
          parameters,
        }),
        retries: config.retries,
      });
      const rawScore = scoreResult.data.score;
      if (
        !Number.isFinite(rawScore) ||
        (config.strictMode && rawScore !== 0 && rawScore !== 1) ||
        (!config.strictMode && (rawScore < scoreRange[0] || rawScore > scoreRange[1]))
      ) {
        throw new RangeError(`G-Eval score ${rawScore} is outside the requested range.`);
      }
      const score = config.strictMode
        ? rawScore
        : (rawScore - scoreRange[0]) / (scoreRange[1] - scoreRange[0]);
      const usage = addUsage(stepsResult.usage, scoreResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: config.includeReason ? scoreResult.data.reason : undefined,
        details: {
          evaluationSteps: stepsResult.steps,
          evaluationParams: options.evaluationParams,
          rawScore,
          scoreRange: [scoreRange[0], scoreRange[1]],
          rubric: rubric.map((entry) => ({
            scoreRange: [entry.scoreRange[0], entry.scoreRange[1]],
            expectedOutcome: entry.expectedOutcome,
          })),
        },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

type ConversationEvalOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  threshold?: number | undefined;
  strictMode?: boolean | undefined;
  includeReason?: boolean | undefined;
  retries?: number | undefined;
  concurrency?: number | undefined;
  turns?: ValueSelector<Input, Output, Expected, ConversationSource> | undefined;
};

export type TurnRelevancyOptions<Input, Output, Expected = unknown> = ConversationEvalOptions<
  Input,
  Output,
  Expected
> & {
  windowSize?: number | undefined;
};

export function turnRelevancy<Input, Output, Expected = unknown>(
  options: TurnRelevancyOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "turn_relevancy");
  const windowSize = validatePositiveInteger(options.windowSize ?? 10, "windowSize");
  const concurrency = validatePositiveInteger(options.concurrency ?? 4, "concurrency");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const turns = await resolveTurns(options.turns, args);
      const interactions = unitInteractions(turns);
      const windows = interactions.map((_, index) =>
        interactions.slice(Math.max(0, index - windowSize + 1), index + 1).flat(),
      );
      const verdictResults = await mapWithConcurrency(windows, concurrency, (window) =>
        runJudge({
          model: options.model,
          schema: binaryVerdictSchema,
          instructions:
            "Judge whether the final assistant reply is relevant to the preceding conversation. Return yes for relevant and no for irrelevant, with a concise reason.",
          prompt: jsonPrompt({ turns: window }),
          retries: config.retries,
        }),
      );
      const verdicts = verdictResults.map((result, index) => ({
        interaction: index + 1,
        ...result.data,
      }));
      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => verdict.verdict === "yes").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "turn relevancy",
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(...verdictResults.map((result) => result.usage), reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { windowSize, concurrency, interactionCount: interactions.length, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

export type KnowledgeRetentionOptions<Input, Output, Expected = unknown> = ConversationEvalOptions<
  Input,
  Output,
  Expected
>;

export function knowledgeRetention<Input, Output, Expected = unknown>(
  options: KnowledgeRetentionOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  const config = metricConfig(options, "knowledge_retention");
  const concurrency = validatePositiveInteger(options.concurrency ?? 4, "concurrency");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const turns = await resolveTurns(options.turns, args);
      const userTurns = turns
        .map((turn, index) => ({ turn, index }))
        .filter((entry) => entry.turn.role === "user");
      const knowledgeResults = await mapWithConcurrency(userTurns, concurrency, (entry) =>
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract durable factual information newly supplied by the final user message. Use prior turns only to resolve references. Return concise facts; return an empty array when nothing new was supplied.",
          prompt: jsonPrompt({
            previousTurns: turns.slice(0, entry.index),
            userMessage: entry.turn.content,
          }),
          retries: config.retries,
        }),
      );
      const knowledge = userTurns.map((entry, index) => ({
        turnIndex: entry.index,
        facts: knowledgeResults[index]?.data.facts ?? [],
      }));
      const assistantChecks = turns
        .map((turn, index) => ({ turn, index }))
        .filter((entry) => entry.turn.role === "assistant")
        .map((entry) => ({
          ...entry,
          facts: knowledge
            .filter((item) => item.turnIndex < entry.index)
            .flatMap((item) => item.facts),
        }))
        .filter((entry) => entry.facts.length > 0);
      const verdictResults = await mapWithConcurrency(assistantChecks, concurrency, (entry) =>
        runJudge({
          model: options.model,
          schema: z.object({ attrition: z.boolean(), reason: z.string() }),
          instructions:
            "Determine whether the assistant reply forgets, contradicts, or unnecessarily asks again for information already supplied by the user. Set attrition true only when knowledge was lost.",
          prompt: jsonPrompt({ knownFacts: entry.facts, assistantReply: entry.turn.content }),
          retries: config.retries,
        }),
      );
      const verdicts = assistantChecks.map((entry, index) => ({
        turnIndex: entry.index,
        attrition: verdictResults[index]?.data.attrition ?? true,
        reason: verdictResults[index]?.data.reason ?? "Missing knowledge-retention verdict.",
      }));
      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => !verdict.attrition).length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        retries: config.retries,
        metric: "knowledge retention",
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(
        ...knowledgeResults.map((result) => result.usage),
        ...verdictResults.map((result) => result.usage),
        reasonResult.usage,
      );
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { concurrency, knowledge, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.invalid(errorMessage(error));
    }
  });
}

function numericMetric<Input, Output, Expected>(
  name: string,
  config: { threshold: number; required: boolean; strictMode?: boolean | undefined },
  direction: "higher_is_better" | "lower_is_better",
  evaluate: (args: EvalMetricArgs<Input, Output, Expected>) => Promise<EvalOutcomeType<number>>,
): EvalMetric<Input, Output, number, Expected> {
  return {
    name,
    required: config.required,
    direction,
    threshold:
      config.strictMode === true ? (direction === "higher_is_better" ? 1 : 0) : config.threshold,
    dataType: "NUMERIC",
    evaluate,
  };
}

type MetricConfig = {
  name: string;
  threshold: number;
  strictMode: boolean;
  includeReason: boolean;
  retries: number;
  required: boolean;
};

function metricConfig(
  options: {
    name?: string | undefined;
    threshold?: number | undefined;
    strictMode?: boolean | undefined;
    includeReason?: boolean | undefined;
    retries?: number | undefined;
    required?: boolean | undefined;
  },
  defaultName: string,
): MetricConfig {
  return {
    name: options.name ?? defaultName,
    threshold: validateThreshold(options.threshold ?? 0.5),
    strictMode: options.strictMode ?? false,
    includeReason: options.includeReason ?? true,
    retries: validateRetries(options.retries ?? 0),
    required: options.required ?? true,
  };
}

function higherOutcome(args: {
  score: number;
  threshold: number;
  strictMode: boolean;
  comment?: string | undefined;
  details: JsonObject;
  usage: Usage;
}) {
  const score = args.strictMode ? (args.score === 1 ? 1 : 0) : args.score;
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

function lowerOutcome(args: {
  score: number;
  threshold: number;
  strictMode: boolean;
  comment?: string | undefined;
  details: JsonObject;
  usage: Usage;
}) {
  const score = args.strictMode ? (args.score === 0 ? 0 : 1) : args.score;
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

async function maybeReason(args: {
  model: CompletionModel;
  includeReason: boolean;
  retries: number;
  metric: string;
  score: number;
  evidence: JsonObject;
}): Promise<{ reason?: string | undefined; usage: Usage }> {
  if (!args.includeReason) return { usage: UsageValue.empty() };
  const result = await runJudge({
    model: args.model,
    schema: reasonSchema,
    instructions: `Write a concise final explanation for the ${args.metric} score. Ground it only in the supplied evidence and do not repeat the numeric score.`,
    prompt: jsonPrompt({ score: args.score, evidence: args.evidence }),
    retries: args.retries,
  });
  return { reason: result.data.reason, usage: result.usage };
}

async function resolveInput<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  return selector === undefined ? formatValue(args.case.input) : selector(args);
}

async function resolveStringList<Input, Output, Expected>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, string[]> | undefined,
  fallback: string[] | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
  label: string,
): Promise<string[]> {
  const value =
    selectorOrValue === undefined
      ? fallback
      : typeof selectorOrValue === "function"
        ? await (selectorOrValue as ValueSelector<Input, Output, Expected, string[]>)(args)
        : selectorOrValue;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new TypeError(`${label} must be a non-empty array of strings.`);
  }
  return value;
}

async function resolveGEvalParameters<Input, Output, Expected>(
  options: GEvalOptions<Input, Output, Expected>,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<JsonObject> {
  const parameters: JsonObject = {};
  for (const parameter of options.evaluationParams) {
    if (parameter === "input") parameters.input = await resolveInput(options.input, args);
    if (parameter === "actualOutput") {
      parameters.actualOutput = await resolveActualText(options.actual, args);
    }
    if (parameter === "expectedOutput") {
      const expected =
        options.expected === undefined ? args.case.expected : await options.expected(args);
      if (expected === undefined) throw new Error("G-Eval expectedOutput is missing.");
      parameters.expectedOutput = toJsonValue(expected);
    }
    if (parameter === "context") {
      parameters.context = await resolveStringList(
        options.context,
        args.case.context,
        args,
        "context",
      );
    }
    if (parameter === "retrievalContext") {
      parameters.retrievalContext = await resolveStringList(
        options.retrievalContext,
        args.case.retrievalContext,
        args,
        "retrievalContext",
      );
    }
    if (parameter === "metadata") parameters.metadata = args.case.metadata ?? {};
  }
  return parameters;
}

function validateRubric(rubric: GEvalRubric[] | undefined): GEvalRubric[] {
  if (rubric === undefined || rubric.length === 0) return [];
  const sorted = [...rubric].sort((left, right) => left.scoreRange[0] - right.scoreRange[0]);
  for (const [index, entry] of sorted.entries()) {
    const [start, end] = entry.scoreRange;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 10 ||
      start > end
    ) {
      throw new RangeError(
        "G-Eval rubric score ranges must be ordered integers from 0 through 10.",
      );
    }
    if (entry.expectedOutcome.trim().length === 0) {
      throw new TypeError("G-Eval rubric expectedOutcome must not be empty.");
    }
    const next = sorted[index + 1];
    if (next !== undefined && end >= next.scoreRange[0]) {
      throw new RangeError("G-Eval rubric score ranges must not overlap.");
    }
  }
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first !== undefined && last !== undefined && first.scoreRange[0] === last.scoreRange[1]) {
    throw new RangeError("G-Eval rubric score range must span more than one value.");
  }
  return sorted;
}

function truthsExtractionInstructions(limit: number | undefined): string {
  return limit === undefined
    ? "Extract concise, factual, undisputed truths from the supplied source material, ordered by importance. Return them in the facts array."
    : `Extract at most ${limit} concise, factual, undisputed truths from the supplied source material, ordered by importance. Return them in the facts array.`;
}

function limitValues(values: string[], limit: number | undefined): string[] {
  return limit === undefined ? values : values.slice(0, limit);
}

function validateThreshold(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Eval metric threshold must be between 0 and 1.");
  }
  return value;
}

function validateRetries(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("Eval metric retries must be a non-negative integer.");
  }
  return value;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function validateOptionalNonNegativeInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertSameLength(label: string, inputs: unknown[], outputs: unknown[]): void {
  if (inputs.length !== outputs.length) {
    throw new Error(`${label} count ${outputs.length} did not match input count ${inputs.length}.`);
  }
}

function jsonPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

type ConversationSource = EvalTurn[] | Message[];

function normalizeEvalTurns(value: unknown): EvalTurn[] | undefined {
  const source = conversationArray(value);
  if (source === undefined) return undefined;
  const turns: EvalTurn[] = [];
  for (const entry of source) {
    if (typeof entry !== "object" || entry === null) continue;
    const role = (entry as { role?: unknown }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = (entry as { content?: unknown }).content;
    const text = contentText(content);
    if (text.length === 0) continue;
    const metadata = (entry as { metadata?: unknown }).metadata;
    turns.push(
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? { role, content: text, metadata: metadata as EvalTurn["metadata"] }
        : { role, content: text },
    );
  }
  return turns.length === 0 ? undefined : turns;
}

async function resolveTurns<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, ConversationSource> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<EvalTurn[]> {
  const source = selector === undefined ? args.output : await selector(args);
  const turns = normalizeEvalTurns(source);
  if (turns === undefined) {
    throw new TypeError(
      "Conversational eval requires non-empty EvalTurn[], Message[], or an output with messages.",
    );
  }
  return turns;
}

function unitInteractions(turns: EvalTurn[]): EvalTurn[][] {
  const interactions: EvalTurn[][] = [];
  let current: EvalTurn[] = [];
  let hasUser = false;
  for (const turn of turns) {
    if (current.at(-1)?.role === "assistant" && turn.role === "user" && hasUser) {
      interactions.push(current);
      current = [turn];
      hasUser = true;
      continue;
    }
    current.push(turn);
    if (turn.role === "user") hasUser = true;
  }
  if (current.length > 1 && current.at(-1)?.role === "assistant" && hasUser) {
    interactions.push(current);
  }
  return interactions;
}

function conversationArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && "messages" in value) {
    const messages = (value as { messages?: unknown }).messages;
    return Array.isArray(messages) ? messages : undefined;
  }
  return undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}
