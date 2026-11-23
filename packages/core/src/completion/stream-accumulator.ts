import { isJsonValue } from "./json";
import { CompletionProviderOutputError } from "./provider-output-error";
import {
  type AccumulatedStreamEvent,
  applyToolCallDelta,
  isNonblankString,
  isReasoningContentType,
  jsonValuesEqual,
  mergeFinalToolCall,
  mergeProviderToolCalls,
  mergeSources,
  nonToolPartsMatchFinal,
  type PartialToolCall,
  parseToolArguments,
  providerOutputErrorWithUsage,
  reasoningContent,
  reasoningDeltaEvent,
  type ReasoningState,
  sourceKey,
  toolCallContent,
} from "./stream-accumulator-helpers";
import type {
  AssistantContentPart,
  CompletionModelStreamEvent,
  CompletionResponse,
  CompletionSource,
  ProviderToolCall,
  ReasoningDetail,
  ToolCallPart,
} from "./types";
import { Usage } from "./types";

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

  accept(event: CompletionModelStreamEvent<RawResponse>): AccumulatedStreamEvent | undefined {
    if (event.type === "text_delta") {
      if (typeof event.delta !== "string") {
        throw new CompletionProviderOutputError({ kind: "invalid-stream-event" });
      }

      this.appendText(event.delta);
      return { type: "text_delta", delta: event.delta };
    }

    if (event.type === "reasoning_delta") {
      if (
        typeof event.delta !== "string" ||
        (event.id !== undefined && !isNonblankString(event.id)) ||
        (event.signature !== undefined && !isNonblankString(event.signature)) ||
        (event.contentType !== undefined && !isReasoningContentType(event.contentType))
      ) {
        throw new CompletionProviderOutputError({ kind: "invalid-stream-event" });
      }

      const reasoning = this.reasoningStateForEvent(event);
      this.appendReasoning(reasoning, event);
      return reasoningDeltaEvent(event);
    }

    if (event.type === "tool_call_delta") {
      if (!isNonblankString(event.id)) {
        throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
      }

      const toolCall = this.toolCallStateForId(event.id);
      applyToolCallDelta(toolCall, event);
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
      if (!isNonblankString(event.id)) {
        throw new CompletionProviderOutputError({ kind: "invalid-stream-event" });
      }

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
    this.assertAccumulatedFinishReason();
    let accumulatedResponse: CompletionResponse<RawResponse>;
    try {
      accumulatedResponse = this.buildAccumulatedResponse();
    } catch (error) {
      if (error instanceof CompletionProviderOutputError && this.finalResponse !== undefined) {
        throw providerOutputErrorWithUsage(error, this.finalResponse.usage);
      }

      throw error;
    }

    if (this.finalResponse !== undefined) {
      if (accumulatedResponse.choice.length === 0) {
        return this.withAccumulatedArtifacts(this.finalResponse, accumulatedResponse);
      }

      return this.mergeFinalResponse(accumulatedResponse, this.finalResponse);
    }

    return accumulatedResponse;
  }

  private assertAccumulatedFinishReason(): void {
    if (this.finalResponse === undefined) {
      if (this.toolCalls.size === 0) {
        throw new CompletionProviderOutputError({ kind: "incomplete-stream" });
      }

      const toolCallId = this.toolCalls.size === 1 ? this.toolCalls.keys().next().value : undefined;
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        toolCallId,
      });
    }

    if (this.toolCalls.size === 0) return;

    const finishReason = this.finalResponse.finishReason;

    if (finishReason === "length") {
      throw new CompletionProviderOutputError({
        kind: "truncated-tool-call",
        finishReason,
        usage: this.finalResponse.usage,
      });
    }

    if (finishReason === "content-filter") {
      throw new CompletionProviderOutputError({
        kind: "filtered-tool-call",
        finishReason,
        usage: this.finalResponse.usage,
      });
    }

    if (finishReason !== undefined && finishReason !== "stop" && finishReason !== "tool-calls") {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        usage: this.finalResponse.usage,
      });
    }
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
    if (
      !isNonblankString(toolCall.toolCallId) ||
      !isNonblankString(toolCall.toolName) ||
      (toolCall.callId !== undefined && !isNonblankString(toolCall.callId)) ||
      (toolCall.signature !== undefined && !isNonblankString(toolCall.signature))
    ) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        toolCallId: isNonblankString(toolCall.toolCallId) ? toolCall.toolCallId : undefined,
      });
    }

    if (!isJsonValue(toolCall.input)) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-arguments",
        toolCallId: toolCall.toolCallId,
      });
    }

    const existing = this.toolCalls.get(toolCall.toolCallId);

    if (existing !== undefined) {
      if (existing.fullCallSeen) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: toolCall.toolCallId,
        });
      }

      if (
        (existing.name.length > 0 && existing.name !== toolCall.toolName) ||
        (existing.callId !== undefined && existing.callId !== toolCall.callId) ||
        (existing.signature !== undefined &&
          toolCall.signature !== undefined &&
          existing.signature !== toolCall.signature)
      ) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: toolCall.toolCallId,
        });
      }

      if (existing.argumentsText.length > 0) {
        const accumulatedInput = parseToolArguments(existing.id, existing.argumentsText);

        if (!jsonValuesEqual(accumulatedInput, toolCall.input)) {
          throw new CompletionProviderOutputError({
            kind: "invalid-tool-call",
            toolCallId: toolCall.toolCallId,
          });
        }
      }
    }

    if (!this.toolCalls.has(toolCall.toolCallId)) {
      this.orderedParts.push({ type: "tool_call", key: toolCall.toolCallId });
    }

    const partial: PartialToolCall = {
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      argumentsText: JSON.stringify(toolCall.input),
      argumentsSnapshotSeen: true,
      fullCallSeen: true,
    };

    if (toolCall.callId !== undefined) {
      partial.callId = toolCall.callId;
    }

    const signature = toolCall.signature ?? existing?.signature;

    if (signature !== undefined) {
      partial.signature = signature;
    }

    this.toolCalls.set(toolCall.toolCallId, partial);
  }

  private mergeFinalResponse(
    accumulatedResponse: CompletionResponse<RawResponse>,
    finalResponse: CompletionResponse<RawResponse>,
  ): CompletionResponse<RawResponse> {
    if (finalResponse.choice.length === 0) {
      const mergedResponse: CompletionResponse<RawResponse> = {
        ...finalResponse,
        choice: accumulatedResponse.choice,
      };
      return this.withAccumulatedArtifacts(mergedResponse, accumulatedResponse);
    }

    const accumulatedNonTool = accumulatedResponse.choice.filter(
      (content) => content.type !== "tool-call",
    );
    const finalNonTool = finalResponse.choice.filter((content) => content.type !== "tool-call");

    if (
      accumulatedNonTool.length > 0 &&
      !nonToolPartsMatchFinal(accumulatedNonTool, finalNonTool)
    ) {
      throw new CompletionProviderOutputError({
        kind: "invalid-stream-event",
        usage: finalResponse.usage,
      });
    }

    const accumulatedById = new Map<string, ToolCallPart>();
    const accumulatedByCallId = new Map<string, ToolCallPart>();
    for (const content of accumulatedResponse.choice) {
      if (content.type !== "tool-call") continue;

      accumulatedById.set(content.toolCallId, content);

      if (content.callId !== undefined) accumulatedByCallId.set(content.callId, content);
    }

    const matchedAccumulatedToolCalls = new Set<ToolCallPart>();
    const choice = finalResponse.choice.map((content) => {
      if (content.type !== "tool-call") return content;

      const accumulated = accumulatedById.get(content.toolCallId);

      if (accumulated === undefined) {
        const changedIdentity =
          content.callId === undefined ? undefined : accumulatedByCallId.get(content.callId);

        if (changedIdentity !== undefined) {
          throw new CompletionProviderOutputError({
            kind: "invalid-tool-call",
            toolCallId: changedIdentity.toolCallId,
            usage: finalResponse.usage,
          });
        }

        return content;
      }

      matchedAccumulatedToolCalls.add(accumulated);
      return mergeFinalToolCall(accumulated, content, finalResponse.usage);
    });

    for (const accumulated of accumulatedById.values()) {
      if (!matchedAccumulatedToolCalls.has(accumulated)) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: accumulated.toolCallId,
          usage: finalResponse.usage,
        });
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
      argumentsSnapshotSeen: false,
      fullCallSeen: false,
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
    let accumulated: CompletionResponse<RawResponse> = { ...withMessageId };

    if (sources.length > 0) accumulated = { ...accumulated, sources };

    if (providerToolCalls.length > 0) {
      accumulated = { ...accumulated, providerToolCalls };
    }

    return accumulated;
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
        let detail: ReasoningDetail = {
          ...last,
          text: `${last.text}${event.delta}`,
        };

        if (event.signature !== undefined) detail = { ...detail, signature: event.signature };

        reasoning.details[reasoning.details.length - 1] = detail;
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
