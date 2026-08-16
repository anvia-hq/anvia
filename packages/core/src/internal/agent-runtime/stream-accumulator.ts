import type { AgentDeltaEvent } from "../../agent/run-types";
import type {
  AssistantContentPart,
  CompletionModelStreamEvent,
  CompletionResponse,
  CompletionSource,
  JsonValue,
  ProviderToolCall,
  ReasoningDetail,
  ToolCallPart,
} from "../../completion/index";
import { Usage } from "../../completion/index";

type ReasoningState = {
  id?: string;
  text: string;
  details?: ReasoningDetail[];
};

type PartialToolCall = {
  id: string;
  callId?: string;
  name: string;
  argumentsText: string;
  signature?: string;
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
  private sources = new Map<string, CompletionSource>();
  private providerToolCalls = new Map<string, ProviderToolCall>();
  private finalResponse: CompletionResponse<RawResponse> | undefined;
  private messageId: string | undefined;
  private nextTextKey = 0;
  private nextReasoningKey = 0;

  accept(event: CompletionModelStreamEvent<RawResponse>): AgentDeltaEvent | undefined {
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
        if (event.argumentsMode === "replace") {
          toolCall.argumentsText = event.argumentsDelta;
        } else {
          toolCall.argumentsText += event.argumentsDelta;
        }
      }
      return undefined;
    }

    if (event.type === "tool_call") {
      this.upsertToolCall(event.toolCall);
      return { type: "tool_call", toolCall: event.toolCall };
    }

    if (event.type === "source") {
      this.sources.set(sourceKey(event.source), event.source);
      return { type: "source", source: event.source };
    }

    if (event.type === "provider_tool_call") {
      this.providerToolCalls.set(event.toolCall.id, event.toolCall);
      return { type: "provider_tool_call", toolCall: event.toolCall };
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
        return this.withAccumulatedArtifacts(this.finalResponse, accumulatedResponse);
      }
      return this.mergeFinalResponse(accumulatedResponse, this.finalResponse);
    }

    return accumulatedResponse;
  }

  private buildAccumulatedResponse(): CompletionResponse<RawResponse> {
    const choice: AssistantContentPart[] = [];

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
        choice.push(
          toolCallContent(toolCall, matchingFinalToolCall(toolCall, this.finalResponse?.choice)),
        );
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
    const sources = [...this.sources.values()];
    if (sources.length > 0) {
      response.sources = sources;
    }
    const providerToolCalls = [...this.providerToolCalls.values()];
    if (providerToolCalls.length > 0) {
      response.providerToolCalls = providerToolCalls;
    }
    return response;
  }

  private upsertToolCall(toolCall: ToolCallPart): void {
    if (!this.toolCalls.has(toolCall.toolCallId)) {
      this.orderedParts.push({ type: "tool_call", key: toolCall.toolCallId });
    }
    const partial: PartialToolCall = {
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      argumentsText: JSON.stringify(toolCall.input ?? {}),
    };
    if (toolCall.callId !== undefined) {
      partial.callId = toolCall.callId;
    }
    if (toolCall.signature !== undefined) {
      partial.signature = toolCall.signature;
    }
    this.toolCalls.set(toolCall.toolCallId, partial);
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
      return this.withAccumulatedArtifacts(mergedResponse, accumulatedResponse);
    }

    const finalById = new Map<string, ToolCallPart>();
    const finalByCallId = new Map<string, ToolCallPart>();
    for (const content of finalResponse.choice) {
      if (content.type !== "tool-call") {
        continue;
      }
      finalById.set(content.toolCallId, content);
      if (content.callId !== undefined) {
        finalByCallId.set(content.callId, content);
      }
    }

    const matchedFinalToolCalls = new Set<ToolCallPart>();
    const choice = accumulatedResponse.choice.map((content) => {
      if (content.type !== "tool-call") {
        return content;
      }

      const finalToolCall =
        finalById.get(content.toolCallId) ??
        (content.callId === undefined ? undefined : finalByCallId.get(content.callId));
      if (finalToolCall === undefined) {
        return content;
      }

      matchedFinalToolCalls.add(finalToolCall);
      return mergeFinalToolCall(content, finalToolCall);
    });

    for (const content of finalResponse.choice) {
      if (content.type !== "tool-call") {
        continue;
      }
      if (!matchedFinalToolCalls.has(content)) {
        choice.push(content);
      }
    }

    return this.withAccumulatedArtifacts({ ...finalResponse, choice }, accumulatedResponse);
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
    event: Extract<CompletionModelStreamEvent<RawResponse>, { type: "reasoning_delta" }>,
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

  private withAccumulatedArtifacts(
    response: CompletionResponse<RawResponse>,
    accumulatedResponse: CompletionResponse<RawResponse>,
  ): CompletionResponse<RawResponse> {
    const withMessageId = this.withMessageIdFallback(response, accumulatedResponse);
    const sources = mergeSources(accumulatedResponse.sources, response.sources);
    const providerToolCalls = mergeProviderToolCalls(
      accumulatedResponse.providerToolCalls,
      response.providerToolCalls,
    );
    return {
      ...withMessageId,
      ...(sources.length === 0 ? {} : { sources }),
      ...(providerToolCalls.length === 0 ? {} : { providerToolCalls }),
    };
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
    event: Extract<CompletionModelStreamEvent<RawResponse>, { type: "reasoning_delta" }>,
  ): void {
    const contentType = event.contentType ?? "text";
    if (contentType === "text" || contentType === "summary") {
      reasoning.text += event.delta;
    }

    if (event.contentType === undefined && event.signature === undefined) {
      return;
    }

    reasoning.details ??= [];
    const last = reasoning.details.at(-1);
    if (contentType === "text") {
      if (last?.type === "text") {
        reasoning.details[reasoning.details.length - 1] = {
          ...last,
          text: `${last.text}${event.delta}`,
          ...(event.signature === undefined ? {} : { signature: event.signature }),
        };
      } else {
        reasoning.details.push(
          event.signature === undefined
            ? { type: "text", text: event.delta }
            : { type: "text", text: event.delta, signature: event.signature },
        );
      }
      return;
    }

    if (contentType === "summary") {
      if (last?.type === "summary") {
        reasoning.details[reasoning.details.length - 1] = {
          ...last,
          text: `${last.text}${event.delta}`,
        };
      } else {
        reasoning.details.push({ type: "summary", text: event.delta });
      }
      return;
    }

    if (contentType === "encrypted") {
      reasoning.details.push({ type: "encrypted", data: event.delta });
      return;
    }

    reasoning.details.push({ type: "redacted", data: event.delta });
  }
}

function sourceKey(source: CompletionSource): string {
  return `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
}

function mergeSources(
  accumulated: CompletionSource[] | undefined,
  final: CompletionSource[] | undefined,
): CompletionSource[] {
  const sources = new Map<string, CompletionSource>();
  for (const source of [...(accumulated ?? []), ...(final ?? [])]) {
    sources.set(sourceKey(source), source);
  }
  return [...sources.values()];
}

function mergeProviderToolCalls(
  accumulated: ProviderToolCall[] | undefined,
  final: ProviderToolCall[] | undefined,
): ProviderToolCall[] {
  const toolCalls = new Map<string, ProviderToolCall>();
  for (const toolCall of [...(accumulated ?? []), ...(final ?? [])]) {
    toolCalls.set(toolCall.id, toolCall);
  }
  return [...toolCalls.values()];
}

function reasoningContent(reasoning: ReasoningState): AssistantContentPart {
  const content =
    reasoning.details === undefined
      ? { type: "reasoning" as const, text: reasoning.text }
      : { type: "reasoning" as const, text: reasoning.text, details: reasoning.details };
  return reasoning.id === undefined ? content : { ...content, id: reasoning.id };
}

function toolCallContent(toolCall: PartialToolCall, finalToolCall?: ToolCallPart): ToolCallPart {
  const argumentsValue =
    finalToolCall !== undefined && !isEmptyToolArguments(finalToolCall.input)
      ? finalToolCall.input
      : parseToolArguments(toolCall.id, toolCall.argumentsText);
  return {
    type: "tool-call",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: argumentsValue,
    ...(toolCall.callId === undefined ? {} : { callId: toolCall.callId }),
    ...(toolCall.signature === undefined ? {} : { signature: toolCall.signature }),
  };
}

function matchingFinalToolCall(
  accumulated: PartialToolCall,
  finalChoice: AssistantContentPart[] | undefined,
): ToolCallPart | undefined {
  const byId = finalChoice?.find(
    (content): content is ToolCallPart =>
      content.type === "tool-call" && content.toolCallId === accumulated.id,
  );
  if (byId !== undefined || accumulated.callId === undefined) {
    return byId;
  }
  return finalChoice?.find(
    (content): content is ToolCallPart =>
      content.type === "tool-call" && content.callId === accumulated.callId,
  );
}

function mergeFinalToolCall(accumulated: ToolCallPart, finalToolCall: ToolCallPart): ToolCallPart {
  const input = isEmptyToolArguments(finalToolCall.input) ? accumulated.input : finalToolCall.input;
  return {
    ...accumulated,
    ...finalToolCall,
    input,
  };
}

function reasoningDeltaEvent(
  event: Extract<CompletionModelStreamEvent, { type: "reasoning_delta" }>,
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

function parseToolArguments(toolCallId: string, text: string): JsonValue {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error(
      `Completion returned tool call "${toolCallId}" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.`,
    );
  }
}
