import {
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionResponse,
  isJsonValue,
  type JsonValue,
  Usage,
  withContextUsage,
} from "@anvia/core/completion";
import {
  isPlainObject,
  numberFrom,
  stringFrom,
  toolCallDelta,
} from "@anvia/core/internal/provider";
import {
  anthropicMessageHasToolUse,
  anthropicMessageUsage,
  anthropicUsage,
  applyAnthropicFinishReason,
  assertAnthropicResponseIntegrity,
  copyUsage,
  fromAnthropicMessage,
  fromAnthropicMessageUnchecked,
  providerOutputError,
  requiredToolCallId,
  requiredToolName,
} from "./completion-response";

type AnthropicStreamToolInput = { type: "empty" } | { type: "complete"; text: string };

type AnthropicStreamToolState = {
  index: number;
  id: string;
  name: string;
  initialInput: AnthropicStreamToolInput;
  partialJson: string;
  hasPartialJson: boolean;
  closed: boolean;
  finalized: boolean;
};

type AnthropicStreamUsageFields = {
  inputTokens: boolean;
  outputTokens: boolean;
  cachedInputTokens: boolean;
  cacheCreationInputTokens: boolean;
};

export class AnthropicCompletionStreamState {
  private readonly toolsByIndex = new Map<number, AnthropicStreamToolState>();
  private readonly toolIndexesById = new Map<string, number>();
  private readonly streamUsage = Usage.empty();
  private readonly streamUsageFields = emptyAnthropicStreamUsageFields();
  private hasStreamUsage = false;
  private hasToolProgress = false;
  private hasTerminalEvent = false;
  private streamMessageId: string | undefined;
  private streamProviderFinishReason: unknown;

  constructor(private readonly modelInfo: CompletionModelInfo | undefined) {}

  *accept(event: unknown): Iterable<CompletionModelStreamEvent> {
    const hadProviderFinishReason = this.streamProviderFinishReason !== undefined;

    if (isPlainObject(event)) {
      if (event.type === "message_start" && isPlainObject(event.message)) {
        this.streamMessageId = stringFrom(event.message.id) ?? this.streamMessageId;

        if (event.message.stop_reason !== undefined && event.message.stop_reason !== null) {
          this.streamProviderFinishReason = acceptAnthropicStreamFinishReason(
            this.streamProviderFinishReason,
            event.message.stop_reason,
            this.streamUsage,
          );
        }
      }

      if (event.type === "message_delta" && isPlainObject(event.delta)) {
        if (event.delta.stop_reason !== undefined && event.delta.stop_reason !== null) {
          this.streamProviderFinishReason = acceptAnthropicStreamFinishReason(
            this.streamProviderFinishReason,
            event.delta.stop_reason,
            this.streamUsage,
          );
        }
      }

      this.hasStreamUsage =
        applyAnthropicStreamUsage(event, this.streamUsage, this.streamUsageFields) ||
        this.hasStreamUsage;
    }

    if (hadProviderFinishReason && isAnthropicSemanticProgressEvent(event)) {
      throw providerOutputError("invalid-tool-call", this.streamUsage);
    }

    if (
      isPlainObject(event) &&
      event.type === "content_block_start" &&
      isPlainObject(event.content_block) &&
      event.content_block.type === "tool_use"
    ) {
      const state = startAnthropicStreamTool(event.index, event.content_block, this.streamUsage);

      if (this.toolsByIndex.has(state.index) || this.toolIndexesById.has(state.id)) {
        throw providerOutputError("invalid-tool-call", this.streamUsage, state.id);
      }

      this.toolsByIndex.set(state.index, state);
      this.toolIndexesById.set(state.id, state.index);
      this.hasToolProgress = true;
      yield toolCallDelta(state.id, {
        name: state.name,
        argumentsDelta:
          state.initialInput.type === "complete" ? state.initialInput.text : undefined,
      });
      return;
    }

    if (
      isPlainObject(event) &&
      event.type === "content_block_delta" &&
      isPlainObject(event.delta) &&
      event.delta.type === "input_json_delta"
    ) {
      const index = anthropicToolStreamIndex(event.index, this.streamUsage);
      const state = this.toolsByIndex.get(index);

      if (state === undefined) {
        throw providerOutputError("invalid-tool-call", this.streamUsage);
      }

      if (state.closed || state.finalized) {
        throw providerOutputError("invalid-tool-call", this.streamUsage, state.id);
      }

      if (typeof event.delta.partial_json !== "string") {
        throw providerOutputError("invalid-tool-arguments", this.streamUsage, state.id);
      }

      if (state.initialInput.type === "complete") {
        throw providerOutputError("invalid-tool-arguments", this.streamUsage, state.id);
      }

      state.hasPartialJson ||= event.delta.partial_json.length > 0;
      state.partialJson += event.delta.partial_json;
      yield toolCallDelta(state.id, { argumentsDelta: event.delta.partial_json });
      return;
    }

    if (isPlainObject(event) && event.type === "content_block_stop") {
      const index = optionalAnthropicToolStreamIndex(event.index);
      const state = index === undefined ? undefined : this.toolsByIndex.get(index);

      if (state !== undefined) {
        if (state.closed) {
          throw providerOutputError("invalid-tool-call", this.streamUsage, state.id);
        }

        state.closed = true;
        return;
      }
    }

    if (isPlainObject(event) && event.type === "message_stop") {
      this.hasTerminalEvent = true;
      const finalMessage = isPlainObject(event.message) ? event.message : undefined;

      if (finalMessage?.stop_reason !== undefined && finalMessage.stop_reason !== null) {
        this.streamProviderFinishReason = acceptAnthropicStreamFinishReason(
          this.streamProviderFinishReason,
          finalMessage.stop_reason,
          this.streamUsage,
        );
      }

      const hasFinalMessageToolUse = anthropicMessageHasToolUse(finalMessage);

      if (this.hasToolProgress || hasFinalMessageToolUse) {
        const baseUsage =
          finalMessage === undefined ? Usage.empty() : anthropicMessageUsage(finalMessage);
        const terminalUsage = this.hasStreamUsage
          ? mergeUsage(baseUsage, this.streamUsage, this.streamUsageFields)
          : baseUsage;
        const terminalResponse = emptyAnthropicStreamResponse(
          event,
          this.streamMessageId,
          terminalUsage,
        );
        applyAnthropicFinishReason(terminalResponse, this.streamProviderFinishReason);
        assertAnthropicResponseIntegrity(terminalResponse, true);
      }

      for (const state of this.toolsByIndex.values()) {
        const finalDelta = finalizeAnthropicStreamTool(state, this.streamUsage);

        if (finalDelta !== undefined) yield finalDelta;
      }

      const baseResponse =
        finalMessage !== undefined
          ? fromAnthropicMessageUnchecked(finalMessage)
          : emptyAnthropicStreamResponse(event, this.streamMessageId, this.streamUsage);
      const response = this.hasStreamUsage
        ? {
            ...baseResponse,
            usage: mergeUsage(baseResponse.usage, this.streamUsage, this.streamUsageFields),
          }
        : baseResponse;
      applyAnthropicFinishReason(response, this.streamProviderFinishReason);
      assertAnthropicResponseIntegrity(response, this.hasToolProgress || hasFinalMessageToolUse);
      yield {
        type: "final",
        response: withContextUsage(response, this.modelInfo),
      };
      return;
    }

    if (isPlainObject(event) && event.type === "error") {
      this.hasTerminalEvent = true;
    }

    for (const mapped of fromAnthropicStreamEvent(event)) {
      yield mapped;
    }
  }

  get isTerminal(): boolean {
    return this.hasTerminalEvent;
  }

  assertComplete(): void {
    if (this.hasToolProgress && !this.hasTerminalEvent) {
      throw providerOutputError("incomplete-stream", this.streamUsage);
    }
  }
}

export function fromAnthropicStreamEvent(event: unknown): CompletionModelStreamEvent[] {
  if (!isPlainObject(event) || typeof event.type !== "string") {
    return [];
  }

  if (event.type === "message_start" && isPlainObject(event.message)) {
    const id = stringFrom(event.message.id);
    return id === undefined ? [] : [{ type: "message_id", id }];
  }

  if (event.type === "content_block_start" && isPlainObject(event.content_block)) {
    const block = event.content_block;

    if (block.type === "tool_use") {
      const state = startAnthropicStreamTool(event.index, block, Usage.empty());
      return [
        toolCallDelta(state.id, {
          name: state.name,
          argumentsDelta: state.initialInput.type === "empty" ? undefined : state.initialInput.text,
        }),
      ];
    }

    if (block.type === "redacted_thinking" && typeof block.data === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: block.data,
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "redacted",
        },
      ];
    }

    return [];
  }

  if (event.type === "content_block_delta" && isPlainObject(event.delta)) {
    const delta = event.delta;

    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return [{ type: "text_delta", delta: delta.text }];
    }

    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: delta.thinking,
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "text",
        },
      ];
    }

    if (delta.type === "signature_delta" && typeof delta.signature === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: "",
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "text",
          signature: delta.signature,
        },
      ];
    }

    if (delta.type === "input_json_delta") return [];
  }

  if (event.type === "message_stop" && isPlainObject(event.message)) {
    return [{ type: "final", response: fromAnthropicMessage(event.message) }];
  }

  if (event.type === "error") {
    return [{ type: "error", error: event.error ?? event }];
  }

  return [];
}

function isAnthropicSemanticProgressEvent(event: unknown): boolean {
  return (
    isPlainObject(event) &&
    (event.type === "content_block_start" || event.type === "content_block_delta")
  );
}

function emptyAnthropicStreamUsageFields(): AnthropicStreamUsageFields {
  return {
    inputTokens: false,
    outputTokens: false,
    cachedInputTokens: false,
    cacheCreationInputTokens: false,
  };
}

function applyAnthropicStreamUsage(
  event: Record<string, unknown>,
  usage: Usage,
  fields: AnthropicStreamUsageFields,
): boolean {
  let changed = false;
  let uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationInputTokens,
  );

  if (event.type === "message_start" && isPlainObject(event.message)) {
    const source = isPlainObject(event.message.usage) ? event.message.usage : undefined;

    if (source !== undefined) {
      if ("input_tokens" in source) {
        uncachedInputTokens = numberFrom(source.input_tokens);
        fields.inputTokens = true;
        changed = true;
      }

      if ("cache_read_input_tokens" in source) {
        usage.cachedInputTokens = numberFrom(source.cache_read_input_tokens);
        fields.cachedInputTokens = true;
        changed = true;
      }

      if ("cache_creation_input_tokens" in source) {
        usage.cacheCreationInputTokens = numberFrom(source.cache_creation_input_tokens);
        fields.cacheCreationInputTokens = true;
        changed = true;
      }
    }
  }

  if (event.type === "message_delta") {
    const source = isPlainObject(event.usage) ? event.usage : undefined;

    if (source !== undefined && "output_tokens" in source) {
      usage.outputTokens = Math.max(usage.outputTokens, numberFrom(source.output_tokens));
      fields.outputTokens = true;
      changed = true;
    }
  }

  if (changed) {
    Object.assign(
      usage,
      anthropicUsage(
        uncachedInputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
        usage.cacheCreationInputTokens,
      ),
    );
  }

  return changed;
}

function mergeUsage(base: Usage, stream: Usage, fields: AnthropicStreamUsageFields): Usage {
  const baseUncachedInputTokens = Math.max(
    0,
    base.inputTokens - base.cachedInputTokens - base.cacheCreationInputTokens,
  );
  const streamUncachedInputTokens = Math.max(
    0,
    stream.inputTokens - stream.cachedInputTokens - stream.cacheCreationInputTokens,
  );
  const uncachedInputTokens = fields.inputTokens
    ? streamUncachedInputTokens
    : baseUncachedInputTokens;
  const outputTokens = fields.outputTokens ? stream.outputTokens : base.outputTokens;
  const cachedInputTokens = fields.cachedInputTokens
    ? stream.cachedInputTokens
    : base.cachedInputTokens;
  const cacheCreationInputTokens = fields.cacheCreationInputTokens
    ? stream.cacheCreationInputTokens
    : base.cacheCreationInputTokens;
  return anthropicUsage(
    uncachedInputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
  );
}

function emptyAnthropicStreamResponse(
  rawResponse: unknown,
  messageId: string | undefined,
  usage: Usage,
): CompletionResponse {
  const response: CompletionResponse = {
    choice: [],
    usage: copyUsage(usage),
    rawResponse,
  };

  if (messageId !== undefined) response.messageId = messageId;

  return response;
}

function startAnthropicStreamTool(
  indexValue: unknown,
  block: Record<string, unknown>,
  usage: Usage,
): AnthropicStreamToolState {
  const index = anthropicToolStreamIndex(indexValue, usage);
  const id = requiredToolCallId(block.id, usage);
  const name = requiredToolName(block.name, id, usage);
  return {
    index,
    id,
    name,
    initialInput: anthropicStreamToolInput(block.input, id, usage),
    partialJson: "",
    hasPartialJson: false,
    closed: false,
    finalized: false,
  };
}

function anthropicStreamToolInput(
  input: unknown,
  toolCallId: string,
  usage: Usage,
): AnthropicStreamToolInput {
  if (!isPlainObject(input) || !isJsonValue(input)) {
    throw providerOutputError("invalid-tool-arguments", usage, toolCallId);
  }

  if (isEmptyJsonObject(input)) {
    return { type: "empty" };
  }

  const text = JSON.stringify(input);

  if (text === undefined) {
    throw providerOutputError("invalid-tool-arguments", usage, toolCallId);
  }

  return { type: "complete", text };
}

function finalizeAnthropicStreamTool(
  state: AnthropicStreamToolState,
  usage: Usage,
): CompletionModelStreamEvent | undefined {
  if (state.finalized) return undefined;

  if (state.initialInput.type === "complete") {
    state.finalized = true;
    return undefined;
  }

  if (state.hasPartialJson) {
    assertSerializedToolInput(state.partialJson, state.id, usage);
    state.finalized = true;
    return undefined;
  }

  state.finalized = true;
  return toolCallDelta(state.id, { argumentsDelta: "{}" });
}

function assertSerializedToolInput(text: string, toolCallId: string, usage: Usage): void {
  const parsed = parseSerializedToolInput(text);

  if (parsed.type === "malformed") {
    throw providerOutputError("malformed-tool-arguments", usage, toolCallId);
  }

  if (parsed.type === "invalid") {
    throw providerOutputError("invalid-tool-arguments", usage, toolCallId);
  }
}

function parseSerializedToolInput(
  text: string,
): { type: "valid"; value: JsonValue } | { type: "malformed" } | { type: "invalid" } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { type: "malformed" };
  }
  return isJsonValue(value) ? { type: "valid", value } : { type: "invalid" };
}

function isEmptyJsonObject(value: JsonValue): boolean {
  return (
    !Array.isArray(value) &&
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 0
  );
}

function anthropicToolStreamIndex(value: unknown, usage: Usage): number {
  const index = optionalAnthropicToolStreamIndex(value);

  if (index === undefined) {
    throw providerOutputError("invalid-tool-call", usage);
  }

  return index;
}

function optionalAnthropicToolStreamIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function acceptAnthropicStreamFinishReason(current: unknown, next: unknown, usage: Usage): unknown {
  if (current === undefined) return next;

  if (current !== next) {
    throw providerOutputError("invalid-tool-call", usage);
  }

  return current;
}
