import {
  type AssistantContentPart,
  type CompletionFinishReason,
  CompletionProviderOutputError,
  type CompletionResponse,
  type JsonValue,
  type Usage,
} from "@anvia/core/completion";
import {
  isNonblankString,
  isPlainObject,
  numberFrom,
  parseToolArguments,
  stringFrom,
} from "@anvia/core/internal/provider";
import { normalizeOpenAIUsage } from "./usage";

export function fromOpenAIChatCompletionResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) throw invalidToolCallError();

  const raw = response;
  const usage = usageFromOpenAIChatCompletion(raw.usage);
  const errorUsage = isPlainObject(raw.usage) ? usage : undefined;
  const firstChoice = primaryStreamChoice(raw.choices);

  if (firstChoice === undefined || !isPlainObject(firstChoice.message)) {
    throw invalidToolCallError(undefined, errorUsage);
  }

  const message = firstChoice.message;
  const choice: AssistantContentPart[] = [];

  const reasoning = stringFrom(message.reasoning) ?? stringFrom(message.reasoning_content);

  if (reasoning !== undefined && reasoning.length > 0) {
    choice.push({
      type: "reasoning",
      text: reasoning,
      details: [{ type: "text", text: reasoning }],
    });
  }

  if (typeof message.content === "string" && message.content.length > 0) {
    choice.push({ type: "text", text: message.content });
  }

  if (typeof message.refusal === "string" && message.refusal.length > 0) {
    choice.push({ type: "text", text: message.refusal });
  }

  const hasRawToolCall =
    message.tool_calls !== undefined &&
    (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0);
  assertSafeOpenAIChatToolFinishReason(firstChoice?.finish_reason, hasRawToolCall, errorUsage);

  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
    throw invalidToolCallError(undefined, errorUsage);
  }

  const toolCalls = message.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    if (!isPlainObject(toolCall)) {
      throw invalidToolCallError(undefined, errorUsage);
    }

    if (!isPlainObject(toolCall.function)) {
      throw invalidToolCallError(toolCall.id, errorUsage);
    }

    assertFunctionToolCallType(toolCall.type, toolCall.id, errorUsage, false);
    const fn = toolCall.function;
    const id = requiredToolCallString(toolCall.id, undefined, errorUsage);
    const name = requiredToolCallString(fn.name, id, errorUsage);
    const input = parseTerminalToolArguments(id, fn.arguments, errorUsage);
    choice.push({
      type: "tool-call",
      toolCallId: id,
      callId: id,
      toolName: name,
      input,
    });
  }

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyOpenAIChatFinishReason(result, firstChoice?.finish_reason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function unsafeOpenAIChatToolFinishError(
  value: unknown,
  usage: Usage | undefined,
): CompletionProviderOutputError {
  if (value === "length") {
    return new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: "length",
      usage,
    });
  }

  return new CompletionProviderOutputError({
    kind: "filtered-tool-call",
    finishReason: "content-filter",
    usage,
  });
}

export function applyOpenAIChatFinishReason(response: CompletionResponse, value: unknown): void {
  if (!isTerminalFinishReason(value)) return;

  response.finishReason = openAIChatFinishReason(value);

  if (typeof value === "string") response.providerFinishReason = value;
}

export function primaryStreamChoice(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value) || !value.every(isPlainObject)) {
    throw invalidToolCallError();
  }

  const choices = value;

  if (choices.length === 0) {
    return undefined;
  }

  const indexedChoices: Array<{ choice: Record<string, unknown>; index: number }> = [];
  const unindexedChoices: Record<string, unknown>[] = [];
  for (const choice of choices) {
    if (choice.index === undefined) {
      unindexedChoices.push(choice);
      continue;
    }

    if (!isStreamIndex(choice.index)) {
      throw invalidToolCallError();
    }

    indexedChoices.push({ choice, index: choice.index });
  }

  if (unindexedChoices.length > 0) {
    if (indexedChoices.length > 0 || unindexedChoices.length > 1) {
      throw invalidToolCallError();
    }

    return unindexedChoices[0];
  }

  const primaryChoices = indexedChoices.filter(({ index }) => index === 0);

  if (primaryChoices.length > 1) {
    throw invalidToolCallError();
  }

  return primaryChoices[0]?.choice;
}

export function toolCallIndex(value: unknown): number {
  if (!isStreamIndex(value)) {
    throw invalidToolCallError();
  }

  return value;
}

export function isTerminalFinishReason(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function assertOptionalToolCallString(value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw invalidToolCallError();
  }
}

export function assertOptionalToolArguments(toolCallId: string, value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
    });
  }
}

export function assertFunctionToolCallType(
  value: unknown,
  toolCallId: unknown,
  usage: Usage | undefined,
  allowMissing: boolean,
): void {
  if (value === "function" || (allowMissing && value === undefined)) return;

  throw invalidToolCallError(toolCallId, usage);
}

export function invalidToolCallError(
  toolCallId?: unknown,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId: isNonblankString(toolCallId) ? toolCallId : undefined,
    usage,
  });
}

export function usageFromOpenAIChatCompletion(usage: unknown): Usage {
  const usageSource = isPlainObject(usage) ? usage : {};
  const promptDetails = isPlainObject(usageSource.prompt_tokens_details)
    ? usageSource.prompt_tokens_details
    : {};
  const completionDetails = isPlainObject(usageSource.completion_tokens_details)
    ? usageSource.completion_tokens_details
    : {};
  const inputTokens = numberFrom(usageSource.prompt_tokens);
  const outputTokens = numberFrom(usageSource.completion_tokens);
  return normalizeOpenAIUsage({
    inputTokens,
    outputTokens,
    cachedInputTokens: numberFrom(promptDetails.cached_tokens),
    reasoningOutputTokens: numberFrom(completionDetails.reasoning_tokens),
  });
}

function assertSafeOpenAIChatToolFinishReason(
  value: unknown,
  hasToolCalls: boolean,
  usage: Usage | undefined,
): void {
  if (!hasToolCalls) return;

  if (!isTerminalFinishReason(value)) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }

  if (value === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: "length",
      usage,
    });
  }

  if (value === "content_filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason: "content-filter",
      usage,
    });
  }

  if (
    isTerminalFinishReason(value) &&
    value !== "tool_calls" &&
    value !== "stop" &&
    value !== "function_call"
  ) {
    throw invalidToolCallError(undefined, usage);
  }
}

function openAIChatFinishReason(value: unknown): CompletionFinishReason {
  if (value === "stop") return "stop";

  if (value === "length") return "length";

  if (value === "content_filter") return "content-filter";

  if (value === "tool_calls" || value === "function_call") return "tool-calls";

  return "other";
}

function isStreamIndex(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function requiredToolCallString(value: unknown, toolCallId?: unknown, usage?: Usage): string {
  if (!isNonblankString(value)) {
    throw invalidToolCallError(toolCallId, usage);
  }

  return value;
}

function parseTerminalToolArguments(toolCallId: string, value: unknown, usage?: Usage): JsonValue {
  if (typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: value === undefined ? "incomplete-tool-call" : "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }

  return parseToolArguments(toolCallId, value, usage);
}
