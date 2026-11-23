import { z } from "zod";
import type { CompletionModel } from "../../completion";
import { isJsonValue, Usage as UsageValue } from "../../completion";
import type { ZodSchema } from "../../schema";
import { errorMessage } from "../format";
import { runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import { resolveActualText } from "../selectors";
import type { EvalMetric, ValueSelector } from "../types";
import {
  higherOutcome,
  jsonPrompt,
  numericMetric,
  reasonSchema,
  validateRetries,
  validateThreshold,
} from "./shared";

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

export function jsonCorrectness<
  Input,
  Output,
  SchemaOutput,
  Expected = unknown,
  const Name extends string = string,
>(
  options: JsonCorrectnessOptions<Input, Output, SchemaOutput, Expected> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name> {
  const threshold = validateThreshold(options.threshold ?? 0.5);
  const retries = validateRetries(options.retries ?? 0);
  const includeReason = options.includeReason ?? true;
  const strictMode = options.strictMode ?? true;
  return numericMetric(
    (options.name ?? "json_correctness") as Name,
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

          if (!isJsonValue(parsed)) {
            throw new TypeError("Generated output is not a JSON value.");
          }

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
              abortSignal: args.signal,
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
        return EvalOutcome.fromError(error);
      }
    },
  );
}
