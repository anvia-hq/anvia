import { isJsonValue } from "./json";
import { CompletionProviderOutputError } from "./provider-output-error";
import type {
  AssistantContentPart,
  CompletionModelStreamEvent,
  CompletionResponse,
  CompletionSource,
  CompletionStreamPart,
  JsonValue,
  ProviderToolCall,
  ReasoningDetail,
  ReasoningPart,
  ToolCallPart,
} from "./types";

export type AccumulatedStreamEvent = Exclude<
  CompletionStreamPart,
  { type: "tool_call_delta" } | { type: "message_id" }
>;

export type ReasoningState = {
  id?: string;
  text: string;
  details?: ReasoningDetail[];
};

export type PartialToolCall = {
  id: string;
  callId?: string;
  name: string;
  argumentsText: string;
  argumentsSnapshotSeen: boolean;
  signature?: string;
  fullCallSeen: boolean;
};

export function applyToolCallDelta(
  toolCall: PartialToolCall,
  event: Extract<CompletionModelStreamEvent, { type: "tool_call_delta" }>,
): void {
  if (toolCall.fullCallSeen) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      toolCallId: toolCall.id,
    });
  }

  if (event.callId !== undefined) {
    if (!isNonblankString(event.callId)) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: toolCall.id,
      });
    }

    if (toolCall.callId !== undefined && toolCall.callId !== event.callId) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: toolCall.id,
      });
    }

    toolCall.callId = event.callId;
  }

  if (event.name !== undefined) {
    if (!isNonblankString(event.name)) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: toolCall.id,
      });
    }

    if (toolCall.name.length > 0 && toolCall.name !== event.name) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: toolCall.id,
      });
    }

    toolCall.name = event.name;
  }

  if (event.signature !== undefined) {
    if (
      !isNonblankString(event.signature) ||
      (toolCall.signature !== undefined && toolCall.signature !== event.signature)
    ) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: toolCall.id,
      });
    }

    toolCall.signature = event.signature;
  }

  if (
    event.argumentsMode !== undefined &&
    event.argumentsMode !== "append" &&
    event.argumentsMode !== "replace"
  ) {
    throw new CompletionProviderOutputError({
      kind: "invalid-stream-event",
      toolCallId: toolCall.id,
    });
  }

  if (event.argumentsMode !== undefined && event.argumentsDelta === undefined) {
    throw new CompletionProviderOutputError({
      kind: "invalid-stream-event",
      toolCallId: toolCall.id,
    });
  }

  if (event.argumentsDelta !== undefined) {
    if (typeof event.argumentsDelta !== "string") {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-arguments",
        toolCallId: toolCall.id,
      });
    }

    if (event.argumentsMode === "replace") {
      if (
        toolCall.argumentsText.length > 0 &&
        toolCall.argumentsText !== event.argumentsDelta &&
        (toolCall.argumentsSnapshotSeen || !event.argumentsDelta.startsWith(toolCall.argumentsText))
      ) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: toolCall.id,
        });
      }

      toolCall.argumentsText = event.argumentsDelta;
      toolCall.argumentsSnapshotSeen = true;
    } else {
      if (toolCall.argumentsSnapshotSeen) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: toolCall.id,
        });
      }

      toolCall.argumentsText += event.argumentsDelta;
    }
  }
}

export function sourceKey(source: CompletionSource): string {
  return `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
}

export function mergeSources(
  accumulated: CompletionSource[] | undefined,
  final: CompletionSource[] | undefined,
): CompletionSource[] {
  const sources = new Map<string, CompletionSource>();
  for (const source of [...(accumulated ?? []), ...(final ?? [])]) {
    sources.set(sourceKey(source), source);
  }
  return [...sources.values()];
}

export function mergeProviderToolCalls(
  accumulated: ProviderToolCall[] | undefined,
  final: ProviderToolCall[] | undefined,
): ProviderToolCall[] {
  const toolCalls = new Map<string, ProviderToolCall>();
  for (const toolCall of [...(accumulated ?? []), ...(final ?? [])]) {
    toolCalls.set(toolCall.id, toolCall);
  }
  return [...toolCalls.values()];
}

export function reasoningContent(reasoning: ReasoningState): AssistantContentPart {
  const content =
    reasoning.details === undefined
      ? { type: "reasoning" as const, text: reasoning.text }
      : { type: "reasoning" as const, text: reasoning.text, details: reasoning.details };
  return reasoning.id === undefined ? content : { ...content, id: reasoning.id };
}

export function toolCallContent(toolCall: PartialToolCall): ToolCallPart {
  const argumentsValue = parseToolArguments(toolCall.id, toolCall.argumentsText);
  let content: ToolCallPart = {
    type: "tool-call",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: argumentsValue,
  };

  if (toolCall.callId !== undefined) content = { ...content, callId: toolCall.callId };

  if (toolCall.signature !== undefined) content = { ...content, signature: toolCall.signature };

  return content;
}

export function mergeFinalToolCall(
  accumulated: ToolCallPart,
  finalToolCall: ToolCallPart,
  usage: CompletionResponse["usage"],
): ToolCallPart {
  if (
    finalToolCall.toolCallId !== accumulated.toolCallId ||
    finalToolCall.toolName !== accumulated.toolName ||
    (accumulated.callId !== undefined && finalToolCall.callId !== accumulated.callId) ||
    (accumulated.signature !== undefined &&
      finalToolCall.signature !== undefined &&
      finalToolCall.signature !== accumulated.signature)
  ) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      toolCallId: accumulated.toolCallId,
      usage,
    });
  }

  if (!isJsonValue(finalToolCall.input)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId: accumulated.toolCallId,
      usage,
    });
  }

  if (!jsonValuesEqual(accumulated.input, finalToolCall.input)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      toolCallId: accumulated.toolCallId,
      usage,
    });
  }

  let merged: ToolCallPart = {
    type: "tool-call",
    toolCallId: finalToolCall.toolCallId,
    toolName: finalToolCall.toolName,
    input: accumulated.input,
  };
  const callId = finalToolCall.callId ?? accumulated.callId;

  if (callId !== undefined) merged = { ...merged, callId };

  const signature = finalToolCall.signature ?? accumulated.signature;

  if (signature !== undefined) merged = { ...merged, signature };

  return merged;
}

export function reasoningDeltaEvent(
  event: Extract<CompletionModelStreamEvent, { type: "reasoning_delta" }>,
): AccumulatedStreamEvent {
  const mapped: AccumulatedStreamEvent = { type: "reasoning_delta", delta: event.delta };

  if (event.id !== undefined) mapped.id = event.id;

  if (event.contentType !== undefined) mapped.contentType = event.contentType;

  if (event.signature !== undefined) mapped.signature = event.signature;

  return mapped;
}

export function parseToolArguments(toolCallId: string, text: string): JsonValue {
  if (text.trim() === "") return {};

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CompletionProviderOutputError({
      kind: "malformed-tool-arguments",
      toolCallId,
    });
  }

  if (!isJsonValue(value)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
    });
  }

  return value;
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  if (isJsonArray(left) || isJsonArray(right)) {
    if (!isJsonArray(left) || !isJsonArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => {
      const rightValue = right[index];
      return rightValue !== undefined && jsonValuesEqual(value, rightValue);
    });
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) {
      return false;
    }

    const leftValue = left[key];
    const rightValue = right[key];

    if (
      leftValue === undefined ||
      rightValue === undefined ||
      !jsonValuesEqual(leftValue, rightValue)
    ) {
      return false;
    }
  }
  return true;
}

export function nonToolPartsMatchFinal(
  accumulated: readonly AssistantContentPart[],
  final: readonly AssistantContentPart[],
): boolean {
  if (!isJsonValue(accumulated) || !isJsonValue(final)) return false;

  const unmatched = [...final];
  for (const part of accumulated) {
    let index = unmatched.findIndex((candidate) => jsonValuesEqual(part, candidate));

    if (index < 0 && part.type === "reasoning") {
      index = unmatched.findIndex(
        (candidate) => candidate.type === "reasoning" && reasoningMatchesFinal(part, candidate),
      );
    }

    if (index < 0) return false;

    unmatched.splice(index, 1);
  }

  return unmatched.every(
    (part) =>
      part.type === "reasoning" &&
      part.text === "" &&
      (part.details === undefined ||
        part.details.every(
          (detail) =>
            detail.type === "encrypted" ||
            ((detail.type === "text" || detail.type === "summary") && detail.text === ""),
        )),
  );
}

function reasoningMatchesFinal(accumulated: ReasoningPart, final: ReasoningPart): boolean {
  if (accumulated.details?.some((detail) => detail.type === "encrypted")) return false;

  if (!final.details?.some((detail) => detail.type === "encrypted")) return false;

  const { details, ...base } = final;
  const streamedDetails = details.filter((detail) => detail.type !== "encrypted");
  const comparable = streamedDetails.length === 0 ? base : { ...base, details: streamedDetails };
  return (
    isJsonValue(accumulated) && isJsonValue(comparable) && jsonValuesEqual(accumulated, comparable)
  );
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function providerOutputErrorWithUsage(
  error: CompletionProviderOutputError,
  usage: CompletionResponse["usage"],
): CompletionProviderOutputError {
  const shared: { toolCallId?: string; usage: CompletionResponse["usage"] } = { usage };

  if (error.toolCallId !== undefined) shared.toolCallId = error.toolCallId;

  if (error.kind === "truncated-tool-call") {
    return new CompletionProviderOutputError({
      ...shared,
      kind: error.kind,
      finishReason: "length",
    });
  }

  if (error.kind === "filtered-tool-call") {
    return new CompletionProviderOutputError({
      ...shared,
      kind: error.kind,
      finishReason: "content-filter",
    });
  }

  if (error.finishReason === "length" || error.finishReason === "content-filter") {
    throw error;
  }

  return new CompletionProviderOutputError({
    ...shared,
    kind: error.kind,
    finishReason: error.finishReason,
  });
}

export function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isReasoningContentType(value: unknown): boolean {
  return value === "text" || value === "summary" || value === "encrypted" || value === "redacted";
}
