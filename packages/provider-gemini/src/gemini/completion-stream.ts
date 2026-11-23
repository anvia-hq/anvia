import {
  type AssistantContentPart,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionResponse,
  type JsonValue,
  type Usage,
} from "@anvia/core/completion";
import { isPlainObject, stringFrom, toolCallDelta } from "@anvia/core/internal/provider";
import {
  applyGeminiFinishReasonValue,
  assertSafeGeminiCompletionResponse,
  assertSafeGeminiToolFinishReason,
  candidateParts,
  fromGeminiGenerateContentResponse,
  functionCallsFromGeminiResponse,
  geminiToolFinishError,
  hasGeminiFunctionCallMarker,
  invalidGeminiToolCall,
  invalidGeminiToolCallArguments,
  providerFinishReasonFromGeminiResponse,
  textFromGeminiResponse,
  toolCallFromGeminiFunctionCall,
  usageFromGemini,
} from "./completion-response";

export type GeminiStreamChunkMapping = Readonly<{
  events: CompletionModelStreamEvent[];
  toolCalls: Extract<AssistantContentPart, { type: "tool-call" }>[];
  hasToolCallMarker: boolean;
  hasSyntheticToolCalls: boolean;
  providerFinishReason?: string | undefined;
  terminalError?: CompletionProviderOutputError | undefined;
}>;

export function fromGeminiGenerateContentStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  const mapping = mapGeminiGenerateContentStreamChunk(chunk);

  if (mapping.terminalError !== undefined) throw mapping.terminalError;

  return mapping.events;
}

export function mapGeminiGenerateContentStreamChunk(chunk: unknown): GeminiStreamChunkMapping {
  if (!isPlainObject(chunk)) {
    return {
      events: [],
      toolCalls: [],
      hasToolCallMarker: false,
      hasSyntheticToolCalls: false,
    };
  }

  const events: CompletionModelStreamEvent[] = [];
  const usage = usageFromGemini(chunk.usageMetadata);
  const parts = candidateParts(chunk, usage);
  const providerFinishReason = providerFinishReasonFromGeminiResponse(chunk);
  const hasToolCallMarker = hasGeminiFunctionCallMarker(chunk, parts);
  const terminalError =
    providerFinishReason === undefined
      ? undefined
      : geminiToolFinishError(providerFinishReason, hasToolCallMarker, usage);
  const calls =
    terminalError === undefined ? functionCallsFromGeminiResponse(chunk, parts, usage) : [];
  const directText = textFromGeminiResponse(chunk, parts);

  if (terminalError === undefined && directText.length > 0 && parts.length === 0) {
    events.push({ type: "text_delta", delta: directText });
  }

  for (const { part } of terminalError === undefined ? parts : []) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        events.push({ type: "reasoning_delta", delta: part.text, contentType: "summary" });
      } else {
        events.push({ type: "text_delta", delta: part.text });
      }
    }
  }
  for (const call of calls) {
    events.push(
      toolCallDelta(call.toolCallId, {
        callId: call.callId,
        name: call.name,
        signature: call.signature,
      }),
    );
    const argumentsDelta = JSON.stringify(call.args);

    if (argumentsDelta === undefined) {
      throw invalidGeminiToolCallArguments(call.toolCallId, usage);
    }

    events.push(
      toolCallDelta(call.toolCallId, {
        callId: call.callId,
        argumentsDelta,
        argumentsMode: "replace",
      }),
    );
  }
  const id = stringFrom(chunk.responseId) ?? stringFrom(chunk.id);

  if (id !== undefined) {
    events.push({ type: "message_id", id });
  }

  if (isPlainObject(chunk.usageMetadata)) {
    if (terminalError === undefined) {
      events.push({ type: "final", response: fromGeminiGenerateContentResponse(chunk) });
    } else {
      const response: CompletionResponse = { choice: [], usage, rawResponse: chunk };

      if (providerFinishReason !== undefined) {
        applyGeminiFinishReasonValue(response, providerFinishReason, true);
      }

      events.push({ type: "final", response });
    }
  }

  return providerFinishReason === undefined
    ? {
        events,
        toolCalls: calls.map(toolCallFromGeminiFunctionCall),
        hasToolCallMarker,
        hasSyntheticToolCalls: calls.some((call) => call.callId === undefined),
        terminalError,
      }
    : {
        events,
        toolCalls: calls.map(toolCallFromGeminiFunctionCall),
        hasToolCallMarker,
        hasSyntheticToolCalls: calls.some((call) => call.callId === undefined),
        providerFinishReason,
        terminalError,
      };
}

export class GeminiCompletionStreamState {
  private readonly toolCalls = new Map<
    string,
    Extract<AssistantContentPart, { type: "tool-call" }>
  >();
  private providerFinishReason: string | undefined;
  private terminalChunk: unknown;
  private finalResponse: CompletionResponse | undefined;
  private sawToolCallMarker = false;
  private sawSyntheticToolCallChunk = false;
  private terminalError: CompletionProviderOutputError | undefined;

  accept(chunk: unknown, mapping: GeminiStreamChunkMapping): void {
    if (mapping.hasSyntheticToolCalls && this.sawSyntheticToolCallChunk) {
      const toolCallId = mapping.toolCalls.find(
        (toolCall) => toolCall.callId === undefined,
      )?.toolCallId;
      throw toolCallId === undefined
        ? new CompletionProviderOutputError({
            kind: "invalid-tool-call",
            usage: this.currentUsage(),
          })
        : invalidGeminiToolCall(toolCallId, this.currentUsage());
    }

    if (
      this.providerFinishReason !== undefined &&
      (mapping.hasToolCallMarker || hasGeminiSemanticProgress(mapping.events))
    ) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        finishReason: "other",
        usage: this.currentUsage(),
      });
    }

    for (const toolCall of mapping.toolCalls) {
      const existing = this.toolCalls.get(toolCall.toolCallId);

      if (existing !== undefined) {
        if (
          existing.callId === undefined ||
          toolCall.callId === undefined ||
          !sameGeminiToolCall(existing, toolCall)
        ) {
          throw invalidGeminiToolCall(toolCall.toolCallId, this.currentUsage());
        }

        continue;
      }

      this.toolCalls.set(toolCall.toolCallId, toolCall);
    }
    this.sawToolCallMarker ||= mapping.hasToolCallMarker;
    this.sawSyntheticToolCallChunk ||= mapping.hasSyntheticToolCalls;
    for (const event of mapping.events) {
      if (event.type === "final") {
        this.finalResponse = event.response;
      }
    }
    this.terminalError ??= mapping.terminalError;

    if (mapping.providerFinishReason !== undefined) {
      if (
        this.providerFinishReason !== undefined &&
        this.providerFinishReason !== mapping.providerFinishReason
      ) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          finishReason: "other",
          usage: this.currentUsage(),
        });
      }

      this.providerFinishReason = mapping.providerFinishReason;
      this.terminalChunk = chunk;
    }
  }

  assertComplete(): void {
    if (this.terminalError !== undefined) {
      throw geminiProviderOutputErrorWithUsage(this.terminalError, this.currentUsage());
    }

    if (!this.sawToolCallMarker && this.toolCalls.size === 0) return;

    if (this.providerFinishReason !== undefined) {
      assertSafeGeminiToolFinishReason(this.providerFinishReason, this.currentUsage());
      return;
    }

    const toolCallId = this.toolCalls.keys().next().value as string | undefined;
    throw new CompletionProviderOutputError(
      toolCallId === undefined
        ? { kind: "incomplete-tool-call", usage: this.currentUsage() }
        : { kind: "incomplete-tool-call", toolCallId, usage: this.currentUsage() },
    );
  }

  finalEvent(): Extract<CompletionModelStreamEvent, { type: "final" }> | undefined {
    let response = this.finalResponse;

    if (response === undefined) {
      if (this.terminalChunk === undefined) {
        return undefined;
      }

      const raw = isPlainObject(this.terminalChunk) ? this.terminalChunk : {};
      response = {
        choice: [],
        usage: usageFromGemini(raw.usageMetadata),
        rawResponse: this.terminalChunk,
      };
      const messageId = stringFrom(raw.responseId) ?? stringFrom(raw.id);

      if (messageId !== undefined) response.messageId = messageId;
    }

    response = mergeGeminiStreamToolCalls(response, [...this.toolCalls.values()]);

    if (this.providerFinishReason !== undefined) {
      applyGeminiFinishReasonValue(response, this.providerFinishReason, this.toolCalls.size > 0);
    }

    assertSafeGeminiCompletionResponse(response);
    return { type: "final", response };
  }

  private currentUsage(): Usage {
    if (this.finalResponse !== undefined) {
      return this.finalResponse.usage;
    }

    const raw = isPlainObject(this.terminalChunk) ? this.terminalChunk : {};
    return usageFromGemini(raw.usageMetadata);
  }
}

function hasGeminiSemanticProgress(events: readonly CompletionModelStreamEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "text_delta" ||
      event.type === "reasoning_delta" ||
      event.type === "tool_call_delta" ||
      event.type === "tool_call" ||
      event.type === "provider_tool_call",
  );
}

function sameGeminiToolCall(
  left: Extract<AssistantContentPart, { type: "tool-call" }>,
  right: Extract<AssistantContentPart, { type: "tool-call" }>,
): boolean {
  return (
    left.toolName === right.toolName &&
    left.callId === right.callId &&
    left.signature === right.signature &&
    sameJsonValue(left.input, right.input)
  );
}

function sameJsonValue(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;

  if (isJsonArray(left) || isJsonArray(right)) {
    return (
      isJsonArray(left) &&
      isJsonArray(right) &&
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index];
        return rightValue !== undefined && sameJsonValue(value, rightValue);
      })
    );
  }

  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && sameJsonValue(left[key] as JsonValue, right[key] as JsonValue),
    )
  );
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function mergeGeminiStreamToolCalls(
  response: CompletionResponse,
  toolCalls: readonly Extract<AssistantContentPart, { type: "tool-call" }>[],
): CompletionResponse {
  if (toolCalls.length === 0) return response;

  const finalIds = new Set(
    response.choice.flatMap((part) => (part.type === "tool-call" ? [part.toolCallId] : [])),
  );
  const missing = toolCalls.filter((toolCall) => !finalIds.has(toolCall.toolCallId));
  return missing.length === 0
    ? response
    : { ...response, choice: [...response.choice, ...missing] };
}

function geminiProviderOutputErrorWithUsage(
  error: CompletionProviderOutputError,
  usage: Usage,
): CompletionProviderOutputError {
  if (error.kind === "truncated-tool-call") {
    return new CompletionProviderOutputError({
      kind: error.kind,
      finishReason: "length",
      toolCallId: error.toolCallId,
      usage,
    });
  }

  if (error.kind === "filtered-tool-call") {
    return new CompletionProviderOutputError({
      kind: error.kind,
      finishReason: "content-filter",
      toolCallId: error.toolCallId,
      usage,
    });
  }

  if (error.finishReason === "length" || error.finishReason === "content-filter") {
    throw error;
  }

  return new CompletionProviderOutputError({
    kind: error.kind,
    finishReason: error.finishReason,
    toolCallId: error.toolCallId,
    usage,
  });
}
