import type { CompletionModel, JsonObject, Usage } from "../completion";
import { Usage as UsageValue } from "../completion";
import { ExtractorBuilder } from "../extractor";
import type { ZodSchema } from "../schema";
import type { EvalMetadata } from "./types";

export type JudgeResult<T> = {
  data: T;
  usage: Usage;
};

export async function runJudge<T>(args: {
  model: CompletionModel;
  schema: ZodSchema<T>;
  instructions: string;
  prompt: string;
  retries: number;
}): Promise<JudgeResult<T>> {
  const result = await new ExtractorBuilder(args.model, args.schema)
    .instructions(args.instructions)
    .temperature(0)
    .retries(args.retries)
    .build()
    .extractWithUsage(args.prompt);
  return { data: result.data, usage: result.usage };
}

export function addUsage(...values: Usage[]): Usage {
  return values.reduce((total, usage) => UsageValue.add(total, usage), UsageValue.empty());
}

export function evaluationMetadata(details: JsonObject, usage: Usage): EvalMetadata {
  const evaluation: JsonObject = {
    ...details,
    usage: usageToJson(usage),
  };
  return { evaluation };
}

export function usageToJson(usage: Usage): JsonObject {
  const value: JsonObject = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
  if (usage.details !== undefined) {
    value.details = { ...usage.details };
  }
  return value;
}
