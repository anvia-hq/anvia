import { addUsage, runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import { resolveActualText } from "../selectors";
import type { EvalMetric } from "../types";
import {
  assertSameLength,
  binaryVerdictsSchema,
  higherOutcome,
  jsonPrompt,
  type LlmEvalOptions,
  maybeReason,
  metricConfig,
  numericMetric,
  resolveInput,
  serializeVerdicts,
  statementsSchema,
  type Verdict,
  verdictsSchema,
  willPassHigher,
} from "./shared";

export type AnswerRelevancyOptions<Input, Output, Expected = unknown> = LlmEvalOptions<
  Input,
  Output,
  Expected
>;

export function answerRelevancy<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: AnswerRelevancyOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name> {
  const config = metricConfig<Name>(options, "answer_relevancy");
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
        abortSignal: args.signal,
        retries: config.retries,
        temperature: config.temperature,
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
          abortSignal: args.signal,
          retries: config.retries,
          temperature: config.temperature,
        });
        verdicts = verdictResult.data.verdicts;
        assertSameLength("answer relevancy verdicts", statements, verdicts);
        usage = addUsage(usage, verdictResult.usage);
      }

      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => verdict.verdict !== "no").length / verdicts.length;
      const serializedVerdicts = serializeVerdicts(verdicts);
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        temperature: config.temperature,
        metric: "answer relevancy",
        abortSignal: args.signal,
        score,
        evidence: { input, verdicts: serializedVerdicts },
      });
      usage = addUsage(usage, reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { statements, verdicts: serializedVerdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
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

export function promptAlignment<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: PromptAlignmentOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name> {
  if (options.promptInstructions.length === 0) {
    throw new TypeError("promptAlignment requires at least one prompt instruction.");
  }

  const config = metricConfig<Name>(options, "prompt_alignment");
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
        abortSignal: args.signal,
        retries: config.retries,
        temperature: config.temperature,
      });
      const verdicts = verdictResult.data.verdicts;
      assertSameLength("prompt alignment verdicts", options.promptInstructions, verdicts);
      const score =
        verdicts.filter((verdict) => verdict.verdict === "yes").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        temperature: config.temperature,
        metric: "prompt alignment",
        abortSignal: args.signal,
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
      return EvalOutcome.fromError(error);
    }
  });
}
