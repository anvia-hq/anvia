import {
  type AssistantContentPart,
  type CompletionFinishReason,
  CompletionProviderOutputError,
  type CompletionProviderOutputErrorKind,
  type CompletionResponse,
  isJsonValue,
  type ReasoningDetail,
  Usage,
} from "@anvia/core/completion";
import { isPlainObject, numberFrom } from "@anvia/core/internal/provider";

export function fromAnthropicMessage(response: unknown): CompletionResponse {
  assertAnthropicRawToolFinish(response);
  const result = fromAnthropicMessageUnchecked(response);
  assertAnthropicResponseIntegrity(result, false);
  return result;
}

export function fromAnthropicMessageUnchecked(response: unknown): CompletionResponse {
  const raw = isPlainObject(response) ? response : {};
  const content = Array.isArray(raw.content) ? raw.content : [];
  const choice: AssistantContentPart[] = [];
  const usage = anthropicMessageUsage(raw);

  for (const block of content) {
    if (!isPlainObject(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      choice.push({ type: "text", text: block.text });
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      const text: Extract<ReasoningDetail, { type: "text" }> =
        typeof block.signature === "string"
          ? { type: "text", text: block.thinking, signature: block.signature }
          : { type: "text", text: block.thinking };
      choice.push({ type: "reasoning", text: block.thinking, details: [text] });
    }

    if (block.type === "redacted_thinking" && typeof block.data === "string") {
      choice.push({
        type: "reasoning",
        text: "",
        details: [{ type: "redacted", data: block.data }],
      });
    }

    if (block.type === "tool_use") {
      const id = requiredToolCallId(block.id, usage);
      const name = requiredToolName(block.name, id, usage);

      if (!isPlainObject(block.input) || !isJsonValue(block.input)) {
        throw providerOutputError("invalid-tool-arguments", usage, id);
      }

      choice.push({
        type: "tool-call",
        toolCallId: id,
        callId: id,
        toolName: name,
        input: block.input,
      });
    }
  }

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyAnthropicFinishReason(result, raw.stop_reason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function applyAnthropicFinishReason(response: CompletionResponse, value: unknown): void {
  if (value === undefined || value === null) return;

  response.finishReason = typeof value === "string" ? anthropicFinishReason(value) : "other";

  if (typeof value === "string") response.providerFinishReason = value;
}

export function assertAnthropicResponseIntegrity(
  response: CompletionResponse,
  hasAccumulatedToolProgress: boolean,
): void {
  const toolCalls = response.choice.filter((content) => content.type === "tool-call");

  if (hasAccumulatedToolProgress || toolCalls.length > 0) {
    assertSafeToolFinishReason(response);
  } else if (response.finishReason === "tool-calls") {
    throw providerOutputError(
      "invalid-tool-call",
      response.usage,
      undefined,
      response.finishReason,
    );
  }

  const ids = new Set<string>();
  for (const toolCall of toolCalls) {
    if (ids.has(toolCall.toolCallId)) {
      throw providerOutputError("invalid-tool-call", response.usage, toolCall.toolCallId);
    }

    ids.add(toolCall.toolCallId);
  }
}

export function anthropicMessageHasToolUse(message: unknown): boolean {
  return (
    isPlainObject(message) &&
    Array.isArray(message.content) &&
    message.content.some((block) => isPlainObject(block) && block.type === "tool_use")
  );
}

export function anthropicMessageUsage(message: Record<string, unknown>): Usage {
  const usage = isPlainObject(message.usage) ? message.usage : {};
  return anthropicUsage(
    numberFrom(usage.input_tokens),
    numberFrom(usage.output_tokens),
    numberFrom(usage.cache_read_input_tokens),
    numberFrom(usage.cache_creation_input_tokens),
  );
}

export function anthropicUsage(
  uncachedInputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): Usage {
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheCreationInputTokens;
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    details: {
      input: uncachedInputTokens,
      cache_read_input_tokens: cachedInputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      output: outputTokens,
      total: totalTokens,
    },
  };
}

export function copyUsage(usage: Usage): Usage {
  let copy: Usage = { ...usage };

  if (usage.details !== undefined) copy = { ...copy, details: { ...usage.details } };

  return copy;
}

export function requiredToolCallId(value: unknown, usage: Usage): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw providerOutputError("invalid-tool-call", usage);
  }

  return value;
}

export function requiredToolName(value: unknown, toolCallId: string, usage: Usage): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw providerOutputError("invalid-tool-call", usage, toolCallId);
  }

  return value;
}

export function providerOutputError(
  kind: CompletionProviderOutputErrorKind,
  usage: Usage,
  toolCallId?: string,
  finishReason?: CompletionFinishReason,
): CompletionProviderOutputError {
  const copiedUsage = copyUsage(usage);

  if (kind === "truncated-tool-call") {
    if (finishReason !== "length") {
      throw new TypeError('Anthropic truncated-tool-call errors require finish reason "length".');
    }

    return new CompletionProviderOutputError({
      kind,
      usage: copiedUsage,
      toolCallId,
      finishReason,
    });
  }

  if (kind === "filtered-tool-call") {
    if (finishReason !== "content-filter") {
      throw new TypeError(
        'Anthropic filtered-tool-call errors require finish reason "content-filter".',
      );
    }

    return new CompletionProviderOutputError({
      kind,
      usage: copiedUsage,
      toolCallId,
      finishReason,
    });
  }

  if (finishReason === "length" || finishReason === "content-filter") {
    throw new TypeError("Anthropic provider output error kind contradicts its finish reason.");
  }

  return new CompletionProviderOutputError({
    kind,
    usage: copiedUsage,
    toolCallId,
    finishReason,
  });
}

function anthropicFinishReason(value: string): CompletionFinishReason {
  if (value === "end_turn" || value === "stop_sequence") return "stop";

  if (value === "max_tokens" || value === "model_context_window_exceeded") return "length";

  if (value === "tool_use") return "tool-calls";

  if (value === "refusal") return "content-filter";

  return "other";
}

function assertAnthropicRawToolFinish(response: unknown): void {
  if (!isPlainObject(response) || !anthropicMessageHasToolUse(response)) return;

  const usage = anthropicMessageUsage(response);
  const terminal: CompletionResponse = { choice: [], usage, rawResponse: response };
  applyAnthropicFinishReason(terminal, response.stop_reason);
  assertAnthropicResponseIntegrity(terminal, true);
}

function assertSafeToolFinishReason(response: CompletionResponse): void {
  if (response.finishReason === undefined) {
    throw providerOutputError("incomplete-tool-call", response.usage);
  }

  if (response.finishReason === "length") {
    throw providerOutputError(
      "truncated-tool-call",
      response.usage,
      undefined,
      response.finishReason,
    );
  }

  if (response.finishReason === "content-filter") {
    throw providerOutputError(
      "filtered-tool-call",
      response.usage,
      undefined,
      response.finishReason,
    );
  }

  if (response.finishReason === "other") {
    throw providerOutputError(
      "invalid-tool-call",
      response.usage,
      undefined,
      response.finishReason,
    );
  }

  if (response.finishReason !== "tool-calls") {
    throw providerOutputError(
      "invalid-tool-call",
      response.usage,
      undefined,
      response.finishReason,
    );
  }
}
