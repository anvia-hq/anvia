import { Usage as UsageValue } from "../../completion";
import { addUsage, type JudgeResult, runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import { resolveActualText } from "../selectors";
import type { EvalMetric } from "../types";
import {
  answersSchema,
  assertSameLength,
  factsSchema,
  higherOutcome,
  jsonPrompt,
  limitValues,
  type LlmEvalOptions,
  maybeReason,
  metricConfig,
  numericMetric,
  questionsSchema,
  resolveInput,
  serializeVerdicts,
  truthsExtractionInstructions,
  validateOptionalNonNegativeInteger,
  validatePositiveInteger,
  type Verdict,
  verdictsSchema,
  willPassHigher,
} from "./shared";

export type SummarizationOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
> & {
  assessmentQuestions?: string[] | undefined;
  questionCount?: number | undefined;
  truthsExtractionLimit?: number | undefined;
};

export function summarization<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: SummarizationOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name> {
  const config = metricConfig<Name>(options, "summarization");
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
              abortSignal: args.signal,
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
          abortSignal: args.signal,
          retries: config.retries,
        }),
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract every concise factual claim made by the summary. Return claims in the facts array.",
          prompt: `Summary:\n${actual}`,
          abortSignal: args.signal,
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
        abortSignal: args.signal,
        retries: config.retries,
      });
      const summaryAnswerPromise = runJudge({
        model: options.model,
        schema: answersSchema,
        instructions:
          "Answer each assessment question using only the supplied text. Return one yes or no answer per question in the same order.",
        prompt: jsonPrompt({ questions, text: actual }),
        abortSignal: args.signal,
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
              abortSignal: args.signal,
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
      const serializedAlignmentVerdicts = serializeVerdicts(alignmentVerdicts);
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        metric: "summarization",
        abortSignal: args.signal,
        score,
        evidence: {
          alignmentVerdicts: serializedAlignmentVerdicts,
          coverageVerdicts,
          alignmentScore,
          coverageScore,
        },
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
          alignmentVerdicts: serializedAlignmentVerdicts,
          coverageVerdicts,
          scoreBreakdown: { alignment: alignmentScore, coverage: coverageScore },
        },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}
