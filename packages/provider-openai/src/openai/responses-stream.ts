import {
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionResponse,
  type ToolCallPart,
  type Usage,
} from "@anvia/core/completion";
import {
  isPlainObject,
  parseToolArguments,
  stringFrom,
  toolCallDelta,
} from "@anvia/core/internal/provider";
import {
  assertCompletedFunctionCallStatus,
  assertSafeOpenAIResponseToolFinishReason,
  fromOpenAIResponse,
  invalidToolArgumentsError,
  invalidToolCallError,
  openAIFunctionCallIdentity,
  parseTerminalToolArguments,
  providerToolCallFromOutputItem,
  requiredTerminalArguments,
  requiredToolCallString,
  sourceFromAnnotation,
  usageFromOpenAIResponse,
} from "./responses-response";

export function fromOpenAIStreamEvent(event: unknown): CompletionModelStreamEvent | undefined {
  if (!isPlainObject(event) || typeof event.type !== "string") {
    return undefined;
  }

  if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
    return typeof event.delta === "string" ? { type: "text_delta", delta: event.delta } : undefined;
  }

  if (
    event.type === "response.reasoning_text.delta" ||
    event.type === "response.reasoning_summary_text.delta"
  ) {
    if (typeof event.delta !== "string") {
      return undefined;
    }

    const mapped: CompletionModelStreamEvent = { type: "reasoning_delta", delta: event.delta };
    const id = stringFrom(event.item_id);

    if (id !== undefined) {
      mapped.id = id;
    }

    if (event.type === "response.reasoning_summary_text.delta") {
      mapped.contentType = "summary";
    } else {
      mapped.contentType = "text";
    }

    return mapped;
  }

  if (event.type === "response.output_item.added" && isPlainObject(event.item)) {
    const item = event.item;

    if (item.type === "function_call") {
      const { id, callId } = openAIFunctionCallIdentity(item);
      const name = requiredToolCallString(item.name, id);

      if (item.arguments !== undefined && typeof item.arguments !== "string") {
        throw invalidToolArgumentsError(id);
      }

      return toolCallDelta(id, {
        callId,
        name,
        argumentsDelta: typeof item.arguments === "string" ? item.arguments : undefined,
      });
    }

    if (typeof item.id === "string") {
      const providerToolCall = providerToolCallFromOutputItem(item);
      return providerToolCall === undefined
        ? { type: "message_id", id: item.id }
        : { type: "provider_tool_call", toolCall: providerToolCall };
    }
  }

  if (event.type === "response.output_text.annotation.added" && isPlainObject(event.annotation)) {
    const source = sourceFromAnnotation(event.annotation);
    return source === undefined ? undefined : { type: "source", source };
  }

  if (event.type === "response.function_call_arguments.delta") {
    const id = requiredToolCallString(event.item_id);

    if (typeof event.delta !== "string") throw invalidToolArgumentsError(id);

    return toolCallDelta(id, { argumentsDelta: event.delta });
  }

  if (event.type === "response.function_call_arguments.done") {
    const id = requiredToolCallString(event.item_id);
    const name = event.name === undefined ? undefined : requiredToolCallString(event.name, id);
    const argumentsText = requiredTerminalArguments(id, event.arguments);
    parseToolArguments(id, argumentsText);
    return toolCallDelta(id, {
      name,
      argumentsDelta: argumentsText,
      argumentsMode: "replace",
    });
  }

  if (event.type === "response.output_item.done" && isPlainObject(event.item)) {
    const item = event.item;

    if (item.type === "function_call") {
      const { id, callId } = openAIFunctionCallIdentity(item);
      assertCompletedFunctionCallStatus(item.status, id);
      const name = requiredToolCallString(item.name, id);
      const toolCall: ToolCallPart = {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: parseTerminalToolArguments(id, item.arguments),
        callId,
      };
      return {
        type: "tool_call",
        toolCall,
      };
    }

    const providerToolCall = providerToolCallFromOutputItem(item);

    if (providerToolCall !== undefined) {
      return { type: "provider_tool_call", toolCall: providerToolCall };
    }
  }

  if (
    (event.type === "response.completed" || event.type === "response.incomplete") &&
    isPlainObject(event.response)
  ) {
    return {
      type: "final",
      response: fromOpenAIResponse(event.response),
    };
  }

  if (event.type === "response.failed" && isPlainObject(event.response)) {
    const mapped: CompletionModelStreamEvent = {
      type: "error",
      error: event.response.error ?? event.response,
    };

    if (isPlainObject(event.response.usage)) {
      mapped.usage = usageFromOpenAIResponse(event.response.usage);
    }

    return mapped;
  }

  if (event.type === "error" || event.type === "response.error") {
    return { type: "error", error: event.error ?? event };
  }

  return undefined;
}

type ResponsesStreamToolCall = {
  id: string;
  name?: string | undefined;
  callId?: string | undefined;
  argumentsDone: boolean;
};

export class OpenAIResponsesStreamState {
  private readonly toolCalls = new Map<string, ResponsesStreamToolCall>();
  private readonly toolCallIdsByCallId = new Map<string, string>();
  private deferredToolArgumentsError: CompletionProviderOutputError | undefined;
  private terminal = false;

  mapEvent(event: unknown): CompletionModelStreamEvent | undefined {
    let mapped: CompletionModelStreamEvent | undefined;
    try {
      mapped = fromOpenAIStreamEvent(event);
    } catch (error) {
      if (this.deferTerminalToolArgumentsError(event, error)) return undefined;

      throw error;
    }

    if (!isPlainObject(event) || typeof event.type !== "string") return mapped;

    if (mapped?.type === "tool_call_delta") {
      this.acceptToolCall(mapped.id, mapped.name, mapped.callId);
    } else if (mapped?.type === "tool_call") {
      this.acceptToolCall(
        mapped.toolCall.toolCallId,
        mapped.toolCall.toolName,
        mapped.toolCall.callId,
      );
    }

    if (event.type === "response.function_call_arguments.delta") {
      this.assertArgumentsOpen(requiredToolCallString(event.item_id));
    }

    if (event.type === "response.function_call_arguments.done") {
      this.markArgumentsDone(requiredToolCallString(event.item_id));
    }

    if (mapped?.type === "final") {
      if (this.terminal) throw invalidToolCallError();

      assertSafeOpenAIResponseToolFinishReason(
        mapped.response,
        this.toolCalls.size > 0 || mapped.response.choice.some((part) => part.type === "tool-call"),
        mapped.response.usage,
      );
      this.assertFinalToolCalls(mapped.response);

      if (this.deferredToolArgumentsError !== undefined) {
        throw terminalArgumentsErrorWithUsage(
          this.deferredToolArgumentsError,
          mapped.response.usage,
        );
      }

      this.terminal = true;
    } else if (mapped?.type === "error") {
      this.terminal = true;
    }

    return mapped;
  }

  assertComplete(): void {
    if (this.terminal) return;

    if (this.toolCalls.size > 0) {
      const id = this.toolCalls.size === 1 ? this.toolCalls.keys().next().value : undefined;
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        toolCallId: id,
      });
    }

    throw new CompletionProviderOutputError({ kind: "incomplete-stream" });
  }

  private acceptToolCall(id: string, name?: string, callId?: string): void {
    const existing = this.toolCalls.get(id) ?? { id, argumentsDone: false };

    if (name !== undefined) {
      if (existing.name !== undefined && existing.name !== name) {
        throw invalidToolCallError(id);
      }

      existing.name = name;
    }

    if (callId !== undefined) {
      if (existing.callId !== undefined && existing.callId !== callId) {
        throw invalidToolCallError(id);
      }

      const existingId = this.toolCallIdsByCallId.get(callId);

      if (existingId !== undefined && existingId !== id) {
        throw invalidToolCallError(id);
      }

      existing.callId = callId;
      this.toolCallIdsByCallId.set(callId, id);
    }

    this.toolCalls.set(id, existing);
  }

  private assertArgumentsOpen(id: string): void {
    if (this.toolCalls.get(id)?.argumentsDone === true) {
      throw invalidToolCallError(id);
    }
  }

  private markArgumentsDone(id: string): void {
    const existing = this.toolCalls.get(id) ?? { id, argumentsDone: false };

    if (existing.argumentsDone) throw invalidToolCallError(id);

    existing.argumentsDone = true;
    this.toolCalls.set(id, existing);
  }

  private deferTerminalToolArgumentsError(event: unknown, error: unknown): boolean {
    if (
      !(error instanceof CompletionProviderOutputError) ||
      (error.kind !== "malformed-tool-arguments" &&
        error.kind !== "invalid-tool-arguments" &&
        error.kind !== "incomplete-tool-call") ||
      !isPlainObject(event)
    ) {
      return false;
    }

    if (event.type === "response.function_call_arguments.done") {
      const id = requiredToolCallString(event.item_id);
      const name = event.name === undefined ? undefined : requiredToolCallString(event.name, id);
      this.acceptToolCall(id, name);
      this.markArgumentsDone(id);
    } else if (
      event.type === "response.output_item.done" &&
      isPlainObject(event.item) &&
      event.item.type === "function_call"
    ) {
      const { id, callId } = openAIFunctionCallIdentity(event.item);
      const name = requiredToolCallString(event.item.name, id);
      this.acceptToolCall(id, name, callId);
    } else {
      return false;
    }

    this.deferredToolArgumentsError ??= error;
    return true;
  }

  private assertFinalToolCalls(response: CompletionResponse): void {
    const finalIds = new Set<string>();
    for (const content of response.choice) {
      if (content.type !== "tool-call") continue;

      this.acceptToolCall(content.toolCallId, content.toolName, content.callId);
      finalIds.add(content.toolCallId);
    }
    for (const toolCall of this.toolCalls.values()) {
      if (
        !finalIds.has(toolCall.id) ||
        toolCall.name === undefined ||
        toolCall.callId === undefined
      ) {
        throw invalidToolCallError(toolCall.id, response.usage);
      }
    }
  }
}

function terminalArgumentsErrorWithUsage(
  error: CompletionProviderOutputError,
  usage: Usage,
): CompletionProviderOutputError {
  if (
    error.kind !== "malformed-tool-arguments" &&
    error.kind !== "invalid-tool-arguments" &&
    error.kind !== "incomplete-tool-call"
  ) {
    throw error;
  }

  return new CompletionProviderOutputError({
    kind: error.kind,
    toolCallId: error.toolCallId,
    usage,
  });
}
