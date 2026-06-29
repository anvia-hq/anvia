import type {
  AssistantContent as AssistantContentType,
  CompletionResponse,
  CompletionStreamEvent,
  ReasoningContent,
  ReasoningContentType,
  ToolCall,
} from "../completion/index";
import { Usage } from "../completion/index";
import { parseJsonValue } from "./utils";

export type AgentDeltaEvent =
  | { type: "text_delta"; delta: string }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | { type: "tool_call"; toolCall: ToolCall };

type ReasoningState = {
  text: string;
  content?: ReasoningContent[];
};

type PartialToolCall = {
  id: string;
  callId?: string;
  name: string;
  argumentsText: string;
  signature?: string;
};

export class CompletionStreamAccumulator<RawResponse = unknown> {
  private static readonly defaultReasoningKey = "reasoning";
  private text = "";
  private reasoningById = new Map<string, ReasoningState>();
  private reasoningOrder: string[] = [];
  private toolCalls = new Map<string, PartialToolCall>();
  private toolCallOrder: string[] = [];
  private finalResponse: CompletionResponse<RawResponse> | undefined;
  private messageId: string | undefined;

  accept(event: CompletionStreamEvent<RawResponse>): AgentDeltaEvent | undefined {
    if (event.type === "text_delta") {
      this.text += event.delta;
      return { type: "text_delta", delta: event.delta };
    }

    if (event.type === "reasoning_delta") {
      const key = event.id ?? CompletionStreamAccumulator.defaultReasoningKey;
      const existing = this.reasoningById.get(key);
      const reasoning = existing ?? { text: "" };
      if (!existing) {
        this.reasoningOrder.push(key);
      }
      this.appendReasoning(reasoning, event);
      this.reasoningById.set(key, reasoning);
      return reasoningDeltaEvent(event);
    }

    if (event.type === "tool_call_delta") {
      const existing = this.toolCalls.get(event.id);
      const toolCall = existing ?? {
        id: event.id,
        name: "",
        argumentsText: "",
      };
      if (!existing) {
        this.toolCallOrder.push(event.id);
      }
      if (event.callId !== undefined) toolCall.callId = event.callId;
      if (event.name !== undefined) toolCall.name = event.name;
      if (event.signature !== undefined) toolCall.signature = event.signature;
      if (event.argumentsDelta !== undefined) {
        toolCall.argumentsText += event.argumentsDelta;
      }
      this.toolCalls.set(event.id, toolCall);
      return undefined;
    }

    if (event.type === "tool_call") {
      this.upsertToolCall(event.toolCall);
      return undefined;
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
      if (this.finalResponse.choice.length === 0) {
        const response = {
          ...accumulatedResponse,
          usage: this.finalResponse.usage,
          rawResponse: this.finalResponse.rawResponse,
        };
        if (this.finalResponse.messageId !== undefined) {
          response.messageId = this.finalResponse.messageId;
        }
        return response;
      }
      return this.mergeFinalResponse(accumulatedResponse, this.finalResponse);
    }

    return accumulatedResponse;
  }

  private buildAccumulatedResponse(): CompletionResponse<RawResponse> {
    const choice: AssistantContentType[] = [];
    if (this.text.length > 0) {
      choice.push({ type: "text", text: this.text });
    }
    for (const key of this.reasoningOrder) {
      const reasoning = this.reasoningById.get(key) ?? { text: "" };
      const id = key === CompletionStreamAccumulator.defaultReasoningKey ? undefined : key;
      const content =
        reasoning.content === undefined
          ? { type: "reasoning" as const, text: reasoning.text }
          : { type: "reasoning" as const, text: reasoning.text, content: reasoning.content };
      choice.push(id === undefined ? content : { ...content, id });
    }
    for (const id of this.toolCallOrder) {
      const toolCall = this.toolCalls.get(id);
      if (toolCall !== undefined) {
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
        choice.push(content);
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
      this.toolCallOrder.push(toolCall.id);
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
    this.toolCalls.set(toolCall.id, partial);
  }

  private mergeFinalResponse(
    accumulatedResponse: CompletionResponse<RawResponse>,
    finalResponse: CompletionResponse<RawResponse>,
  ): CompletionResponse<RawResponse> {
    const accumulatedById = new Map<string, ToolCall>();
    const accumulatedByCallId = new Map<string, ToolCall>();
    for (const content of accumulatedResponse.choice) {
      if (content.type !== "tool_call") {
        continue;
      }
      accumulatedById.set(content.id, content);
      if (content.callId !== undefined) {
        accumulatedByCallId.set(content.callId, content);
      }
    }

    return {
      ...finalResponse,
      choice: finalResponse.choice.map((content) => {
        if (content.type !== "tool_call" || !isEmptyToolArguments(content.function.arguments)) {
          return content;
        }

        const accumulated =
          accumulatedById.get(content.id) ??
          (content.callId === undefined ? undefined : accumulatedByCallId.get(content.callId));
        if (accumulated === undefined || isEmptyToolArguments(accumulated.function.arguments)) {
          return content;
        }

        return {
          ...content,
          function: {
            ...content.function,
            arguments: accumulated.function.arguments,
          },
        };
      }),
    };
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
