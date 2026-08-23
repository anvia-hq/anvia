import {
  CompletionProviderOutputError,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  Usage,
} from "@anvia/core/completion";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeOpenAIUsage(options: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
}): Usage {
  const inputTokens = Math.max(0, options.inputTokens);
  const outputTokens = Math.max(0, options.outputTokens);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, options.cachedInputTokens));
  const reasoningOutputTokens = Math.min(outputTokens, Math.max(0, options.reasoningOutputTokens));
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    details: {
      input: inputTokens - cachedInputTokens,
      input_cached_tokens: cachedInputTokens,
      output: outputTokens - reasoningOutputTokens,
      output_reasoning_tokens: reasoningOutputTokens,
      total: totalTokens,
    },
  };
}

export function parseToolArguments(toolCallId: string, text: string, usage?: Usage): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CompletionProviderOutputError({
      kind: "malformed-tool-arguments",
      toolCallId,
      usage,
    });
  }
  if (!isJsonValue(value)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return value;
}

export function schemaName(schema: JsonObject): string {
  return typeof schema.title === "string" ? schema.title : "response_schema";
}
