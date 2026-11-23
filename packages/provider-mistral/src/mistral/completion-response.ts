import {
  type AssistantContentPart,
  type CompletionFinishReason,
  CompletionProviderOutputError,
  type CompletionResponse,
  isJsonValue,
  type JsonValue,
  Usage,
} from "@anvia/core/completion";
import {
  isNonblankString,
  isPlainObject,
  numberFrom,
  parseToolArguments,
  stringFrom,
} from "@anvia/core/internal/provider";

export function fromMistralChatResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  const raw = response;
  const usage = usageFromMistral(raw.usage);
  const primaryChoice = primaryMistralChoice(raw.choices, usage);
  const message = isPlainObject(primaryChoice?.message) ? primaryChoice.message : {};
  const providerFinishReason = finishReasonFromChoice(primaryChoice);
  const finishReason =
    providerFinishReason === undefined ? undefined : mistralFinishReason(providerFinishReason);
  const choice: AssistantContentPart[] = [];

  const text = stringContent(message.content);

  if (text !== undefined && text.length > 0) {
    choice.push({ type: "text", text });
  }

  const rawToolCalls = message.toolCalls ?? message.tool_calls;
  assertSafeToolCallFinish(hasRawToolCallValue(rawToolCalls) ? 1 : 0, finishReason, usage);
  const toolCalls = toolCallsFrom(message, usage);
  for (const [index, toolCall] of toolCalls.entries()) {
    if (!isPlainObject(toolCall.function)) {
      throw invalidMistralToolCall(undefined, usage);
    }

    assertMistralFunctionToolCall(toolCall, usage);
    const fn = toolCall.function;
    const id =
      optionalMistralToolCallId(toolCall.id, usage) ?? deterministicToolCallId(raw.id, index);

    if (!isNonblankString(id) || !isNonblankString(fn.name)) {
      throw invalidMistralToolCall(isNonblankString(id) ? id : undefined, usage);
    }

    const args = parseToolArgumentsValue(id, fn.arguments, usage);
    choice.push({
      type: "tool-call",
      toolCallId: id,
      callId: id,
      toolName: fn.name,
      input: args,
    });
  }

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyMistralFinishReason(result, providerFinishReason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function applyMistralFinishReason(
  response: CompletionResponse,
  value: string | undefined,
): void {
  if (value === undefined) return;

  response.finishReason = mistralFinishReason(value);
  response.providerFinishReason = value;
}

export function mistralFinishReason(value: string): CompletionFinishReason {
  if (value === "stop") return "stop";

  if (value === "length" || value === "model_length") return "length";

  if (value === "content_filter" || value === "safety") return "content-filter";

  if (value === "tool_calls" || value === "function_call") return "tool-calls";

  return "other";
}

export function usageFromMistral(usage: unknown): Usage {
  const raw = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(raw.promptTokens) || numberFrom(raw.prompt_tokens);
  const outputTokens = numberFrom(raw.completionTokens) || numberFrom(raw.completion_tokens);
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    details: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
    },
  };
}

export function hasRawToolCallValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

export function toolCallsFrom(
  message: Record<string, unknown>,
  usage?: Usage,
): Record<string, unknown>[] {
  const raw = message.toolCalls ?? message.tool_calls;

  if (raw === undefined) return [];

  if (!Array.isArray(raw) || raw.some((toolCall) => !isPlainObject(toolCall))) {
    throw invalidMistralToolCall(undefined, usage);
  }

  return raw;
}

export function stringContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .flatMap((part) => {
        if (!isPlainObject(part)) {
          return [];
        }

        return typeof part.text === "string" ? [part.text] : [];
      })
      .join("");
    return text.length > 0 ? text : undefined;
  }

  return undefined;
}

export function primaryMistralChoice(
  value: unknown,
  usage?: Usage,
  options: Readonly<{ allowMissingPrimary?: boolean }> = {},
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    throw invalidMistralToolCall(undefined, usage);
  }

  const choices = value.filter(isPlainObject);

  if (choices.length !== value.length) {
    throw invalidMistralToolCall(undefined, usage);
  }

  if (
    choices.some(
      (choice) =>
        choice.index !== undefined &&
        (!Number.isSafeInteger(choice.index) || (choice.index as number) < 0),
    )
  ) {
    throw invalidMistralToolCall(undefined, usage);
  }

  const indexed = choices.filter((choice) => choice.index === 0);

  if (indexed.length === 1) return indexed[0];

  if (indexed.length > 1) throw invalidMistralToolCall(undefined, usage);

  if (choices.length === 0) return undefined;

  if (choices.length === 1 && (choices[0]?.index === undefined || choices[0]?.index === 0)) {
    return choices[0];
  }

  if (
    options.allowMissingPrimary === true &&
    choices.every((choice) => choice.index !== undefined)
  ) {
    return undefined;
  }

  throw invalidMistralToolCall(undefined, usage);
}

export function finishReasonFromChoice(
  choice: Record<string, unknown> | undefined,
): string | undefined {
  return stringFrom(choice?.finishReason) ?? stringFrom(choice?.finish_reason);
}

export function assertSafeToolCallFinish(
  toolCallCount: number,
  finishReason: CompletionFinishReason | undefined,
  usage?: Usage,
): void {
  if (toolCallCount === 0) return;

  if (finishReason === undefined) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }

  if (finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }

  if (finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }

  if (finishReason === "other") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason,
      usage,
    });
  }
}

export function assertMistralFunctionToolCall(
  toolCall: Record<string, unknown>,
  usage?: Usage,
): void {
  if (toolCall.type !== undefined && toolCall.type !== "function") {
    throw invalidMistralToolCall(optionalMistralToolCallId(toolCall.id, usage), usage);
  }
}

export function optionalMistralToolCallId(value: unknown, usage?: Usage): string | undefined {
  if (value === undefined || value === null || value === "null") return undefined;

  if (!isNonblankString(value)) throw invalidMistralToolCall(undefined, usage);

  return value;
}

export function invalidMistralToolCall(
  toolCallId: string | undefined,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId,
    usage,
  });
}

function parseToolArgumentsValue(toolCallId: string, args: unknown, usage: Usage): JsonValue {
  if (typeof args === "string") {
    return parseToolArguments(toolCallId, args, usage);
  }

  if (!isPlainObject(args) || !isJsonValue(args)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }

  return args;
}

function deterministicToolCallId(responseId: unknown, index: number): string {
  const prefix = typeof responseId === "string" && responseId.length > 0 ? responseId : "mistral";
  return `${prefix}-tool-${index.toString()}`;
}
