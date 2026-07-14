import type {
  AssistantContent as AssistantContentType,
  CompletionResponse,
  CompletionStreamEvent,
  JsonValue,
  ReasoningContent,
  ToolCall,
} from "../../completion/index";
import { Usage } from "../../completion/index";
import type { AgentDeltaEvent } from "../../request/types";

type ReasoningState = {
  id?: string;
  text: string;
  content?: ReasoningContent[];
};

type PartialToolCall = {
  id: string;
  callId?: string;
  name: string;
  argumentsText: string;
  signature?: string;
  additionalParams?: JsonValue;
};

type OrderedPartRef =
  | { type: "text"; key: string }
  | { type: "reasoning"; key: string }
  | { type: "tool_call"; key: string };

export class CompletionStreamAccumulator<RawResponse = unknown> {
  private orderedParts: OrderedPartRef[] = [];
  private textParts = new Map<string, string>();
  private reasoningByKey = new Map<string, ReasoningState>();
  private reasoningKeyById = new Map<string, string>();
  private toolCalls = new Map<string, PartialToolCall>();
  private finalResponse: CompletionResponse<RawResponse> | undefined;
  private messageId: string | undefined;
  private nextTextKey = 0;
  private nextReasoningKey = 0;

  accept(event: CompletionStreamEvent<RawResponse>): AgentDeltaEvent | undefined {
    if (event.type === "text_delta") {
      this.appendText(event.delta);
      return { type: "text_delta", delta: event.delta };
    }

    if (event.type === "reasoning_delta") {
      const reasoning = this.reasoningStateForEvent(event);
      this.appendReasoning(reasoning, event);
      return reasoningDeltaEvent(event);
    }

    if (event.type === "tool_call_delta") {
      const toolCall = this.toolCallStateForId(event.id);
      if (event.callId !== undefined && event.callId.length > 0) toolCall.callId = event.callId;
      if (event.name !== undefined && event.name.length > 0) toolCall.name = event.name;
      if (event.signature !== undefined) toolCall.signature = event.signature;
      if (event.argumentsDelta !== undefined) {
        toolCall.argumentsText += event.argumentsDelta;
      }
      return undefined;
    }

    if (event.type === "tool_call") {
      this.upsertToolCall(event.toolCall);
      return { type: "tool_call", toolCall: event.toolCall };
    }

    if (event.type === "message_id") {
      this.messageId = event.id;
      return undefined;
    }

    if (event.type === "final") {
      this.finalResponse = event.response;
      return undefined;
    }

    return undefined;
  }

  response(): CompletionResponse<RawResponse> {
    const accumulatedResponse = this.buildAccumulatedResponse();
    if (this.finalResponse !== undefined) {
      if (accumulatedResponse.choice.length === 0) {
        return this.withMessageIdFallback(this.finalResponse, accumulatedResponse);
      }
      return this.mergeFinalResponse(accumulatedResponse, this.finalResponse);
    }

    return accumulatedResponse;
  }

  private buildAccumulatedResponse(): CompletionResponse<RawResponse> {
    const choice: AssistantContentType[] = [];

    for (const part of this.orderedParts) {
      if (part.type === "text") {
        const text = this.textParts.get(part.key) ?? "";
        if (text.length > 0) {
          choice.push({ type: "text", text });
        }
        continue;
      }

      if (part.type === "reasoning") {
        const reasoning = this.reasoningByKey.get(part.key);
        if (reasoning !== undefined) {
          choice.push(reasoningContent(reasoning));
        }
        continue;
      }

      const toolCall = this.toolCalls.get(part.key);
      if (toolCall !== undefined) {
        choice.push(toolCallContent(toolCall));
      }
    }

    const response: CompletionResponse<RawResponse> = {
      choice,
      usage: Usage.empty(),
      rawResponse: undefined as RawResponse,
    };
    if (this.messageId !== undefined) {
      response.messageId = this.messageId;
    }
    return response;
  }

  private upsertToolCall(toolCall: ToolCall): void {
    if (!this.toolCalls.has(toolCall.id)) {
      this.orderedParts.push({ type: "tool_call", key: toolCall.id });
    }
    const partial: PartialToolCall = {
      id: toolCall.id,
      name: toolCall.function.name,
      argumentsText: JSON.stringify(toolCall.function.arguments ?? {}),
    };
    if (toolCall.callId !== undefined) {
      partial.callId = toolCall.callId;
    }
    if (toolCall.signature !== undefined) {
      partial.signature = toolCall.signature;
    }
    if (toolCall.additionalParams !== undefined) {
      partial.additionalParams = toolCall.additionalParams;
    }
    this.toolCalls.set(toolCall.id, partial);
  }

  private mergeFinalResponse(
    accumulatedResponse: CompletionResponse<RawResponse>,
    finalResponse: CompletionResponse<RawResponse>,
  ): CompletionResponse<RawResponse> {
    if (finalResponse.choice.length === 0) {
      const mergedResponse: CompletionResponse<RawResponse> = {
        ...accumulatedResponse,
        usage: finalResponse.usage,
        rawResponse: finalResponse.rawResponse,
      };
      if (finalResponse.messageId !== undefined) {
        mergedResponse.messageId = finalResponse.messageId;
      }
      return this.withMessageIdFallback(mergedResponse, accumulatedResponse);
    }

    const finalById = new Map<string, ToolCall>();
    const finalByCallId = new Map<string, ToolCall>();
    for (const content of finalResponse.choice) {
      if (content.type !== "tool_call") {
        continue;
      }
      finalById.set(content.id, content);
      if (content.callId !== undefined) {
        finalByCallId.set(content.callId, content);
      }
    }

    const matchedFinalToolCalls = new Set<ToolCall>();
    const choice = accumulatedResponse.choice.map((content) => {
      if (content.type !== "tool_call") {
        return content;
      }

      const finalToolCall =
        finalById.get(content.id) ??
        (content.callId === undefined ? undefined : finalByCallId.get(content.callId));
      if (finalToolCall === undefined) {
        return content;
      }

      matchedFinalToolCalls.add(finalToolCall);
      return mergeFinalToolCall(content, finalToolCall);
    });

    for (const content of finalResponse.choice) {
      if (content.type !== "tool_call") {
        continue;
      }
      if (!matchedFinalToolCalls.has(content)) {
        choice.push(content);
      }
    }

    return this.withMessageIdFallback({ ...finalResponse, choice }, accumulatedResponse);
  }

  private appendText(delta: string): void {
    const lastPart = this.orderedParts.at(-1);
    const key = lastPart?.type === "text" ? lastPart.key : this.createTextKey();
    if (lastPart?.type !== "text") {
      this.orderedParts.push({ type: "text", key });
    }
    this.textParts.set(key, `${this.textParts.get(key) ?? ""}${delta}`);
  }

  private reasoningStateForEvent(
    event: Extract<CompletionStreamEvent<RawResponse>, { type: "reasoning_delta" }>,
  ): ReasoningState {
    if (event.id !== undefined) {
      const existingKey = this.reasoningKeyById.get(event.id);
      if (existingKey !== undefined) {
        const existing = this.reasoningByKey.get(existingKey);
        if (existing !== undefined) {
          return existing;
        }
      }

      const key = this.createReasoningKey();
      const reasoning: ReasoningState = { id: event.id, text: "" };
      this.reasoningKeyById.set(event.id, key);
      this.reasoningByKey.set(key, reasoning);
      this.orderedParts.push({ type: "reasoning", key });
      return reasoning;
    }

    const lastPart = this.orderedParts.at(-1);
    if (lastPart?.type === "reasoning") {
      const lastReasoning = this.reasoningByKey.get(lastPart.key);
      if (lastReasoning !== undefined && lastReasoning.id === undefined) {
        return lastReasoning;
      }
    }

    const key = this.createReasoningKey();
    const reasoning: ReasoningState = { text: "" };
    this.reasoningByKey.set(key, reasoning);
    this.orderedParts.push({ type: "reasoning", key });
    return reasoning;
  }

  private toolCallStateForId(id: string): PartialToolCall {
    const existing = this.toolCalls.get(id);
    if (existing !== undefined) {
      return existing;
    }

    const toolCall: PartialToolCall = {
      id,
      name: "",
      argumentsText: "",
    };
    this.toolCalls.set(id, toolCall);
    this.orderedParts.push({ type: "tool_call", key: id });
    return toolCall;
  }

  private withMessageIdFallback(
    response: CompletionResponse<RawResponse>,
    accumulatedResponse: CompletionResponse<RawResponse>,
  ): CompletionResponse<RawResponse> {
    if (response.messageId !== undefined || accumulatedResponse.messageId === undefined) {
      return response;
    }
    return { ...response, messageId: accumulatedResponse.messageId };
  }

  private createTextKey(): string {
    this.nextTextKey += 1;
    return `text_${this.nextTextKey.toString()}`;
  }

  private createReasoningKey(): string {
    this.nextReasoningKey += 1;
    return `reasoning_${this.nextReasoningKey.toString()}`;
  }

  private appendReasoning(
    reasoning: ReasoningState,
    event: Extract<CompletionStreamEvent<RawResponse>, { type: "reasoning_delta" }>,
  ): void {
    const contentType = event.contentType ?? "text";
    if (contentType === "text" || contentType === "summary") {
      reasoning.text += event.delta;
    }

    if (event.contentType === undefined && event.signature === undefined) {
      return;
    }

    reasoning.content ??= [];
    const last = reasoning.content.at(-1);
    if (contentType === "text") {
      if (last?.type === "text") {
        last.text += event.delta;
        if (event.signature !== undefined) {
          last.signature = event.signature;
        }
      } else {
        reasoning.content.push(
          event.signature === undefined
            ? { type: "text", text: event.delta }
            : { type: "text", text: event.delta, signature: event.signature },
        );
      }
      return;
    }

    if (contentType === "summary") {
      if (last?.type === "summary") {
        last.text += event.delta;
      } else {
        reasoning.content.push({ type: "summary", text: event.delta });
      }
      return;
    }

    if (contentType === "encrypted") {
      reasoning.content.push({ type: "encrypted", data: event.delta });
      return;
    }

    reasoning.content.push({ type: "redacted", data: event.delta });
  }
}

function reasoningContent(reasoning: ReasoningState): AssistantContentType {
  const content =
    reasoning.content === undefined
      ? { type: "reasoning" as const, text: reasoning.text }
      : { type: "reasoning" as const, text: reasoning.text, content: reasoning.content };
  return reasoning.id === undefined ? content : { ...content, id: reasoning.id };
}

function toolCallContent(toolCall: PartialToolCall): ToolCall {
  const content: ToolCall = {
    type: "tool_call",
    id: toolCall.id,
    function: {
      name: toolCall.name,
      arguments: parseJsonValue(toolCall.argumentsText),
    },
  };
  if (toolCall.callId !== undefined) {
    content.callId = toolCall.callId;
  }
  if (toolCall.signature !== undefined) {
    content.signature = toolCall.signature;
  }
  if (toolCall.additionalParams !== undefined) {
    content.additionalParams = toolCall.additionalParams;
  }
  return content;
}

function mergeFinalToolCall(accumulated: ToolCall, finalToolCall: ToolCall): ToolCall {
  const argumentsValue = isEmptyToolArguments(finalToolCall.function.arguments)
    ? accumulated.function.arguments
    : finalToolCall.function.arguments;
  return {
    ...accumulated,
    ...finalToolCall,
    function: {
      ...accumulated.function,
      ...finalToolCall.function,
      arguments: argumentsValue,
    },
  };
}

function reasoningDeltaEvent(
  event: Extract<CompletionStreamEvent, { type: "reasoning_delta" }>,
): AgentDeltaEvent {
  const mapped: AgentDeltaEvent = { type: "reasoning_delta", delta: event.delta };
  if (event.id !== undefined) mapped.id = event.id;
  if (event.contentType !== undefined) mapped.contentType = event.contentType;
  if (event.signature !== undefined) mapped.signature = event.signature;
  return mapped;
}

function isEmptyToolArguments(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.values(value).every((item) => item === undefined);
  }
  return false;
}

function parseJsonValue(text: string): JsonValue {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}
