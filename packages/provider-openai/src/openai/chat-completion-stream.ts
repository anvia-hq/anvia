import {
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionResponse,
  Usage,
} from "@anvia/core/completion";
import {
  isNonblankString,
  isPlainObject,
  parseToolArguments,
  stringFrom,
  toolCallDelta,
} from "@anvia/core/internal/provider";
import {
  applyOpenAIChatFinishReason,
  assertFunctionToolCallType,
  assertOptionalToolArguments,
  assertOptionalToolCallString,
  invalidToolCallError,
  isTerminalFinishReason,
  primaryStreamChoice,
  toolCallIndex,
  unsafeOpenAIChatToolFinishError,
  usageFromOpenAIChatCompletion,
} from "./chat-completion-response";

type ChatCompletionStreamChunkMapping = {
  events: CompletionModelStreamEvent[];
  hasToolCalls: boolean;
  hasFinishReason: boolean;
  hasChoices: boolean;
  hasPrimaryChoice: boolean;
  finishReason?: unknown;
};

type StreamedChatToolCall = {
  id: string;
  callId?: string | undefined;
  name?: string | undefined;
  argumentsText: string;
};

export function fromOpenAIChatCompletionStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  return mapOpenAIChatCompletionStreamChunk(chunk).events;
}

function mapOpenAIChatCompletionStreamChunk(
  chunk: unknown,
  reasoningId?: string,
  options: Readonly<{ deferUnsafeToolFinish?: boolean }> = {},
): ChatCompletionStreamChunkMapping {
  if (!isPlainObject(chunk)) {
    return {
      events: [],
      hasToolCalls: false,
      hasFinishReason: false,
      hasChoices: false,
      hasPrimaryChoice: false,
    };
  }

  const events: CompletionModelStreamEvent[] = [];
  const choice = primaryStreamChoice(chunk.choices);
  const rawToolMarker =
    choice !== undefined && isPlainObject(choice.delta) && choice.delta.tool_calls !== undefined;
  const hasUnsafeToolFinish =
    rawToolMarker &&
    (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter");

  if (hasUnsafeToolFinish && options.deferUnsafeToolFinish !== true) {
    throw unsafeOpenAIChatToolFinishError(
      choice?.finish_reason,
      isPlainObject(chunk.usage) ? usageFromOpenAIChatCompletion(chunk.usage) : undefined,
    );
  }

  let hasToolCalls = hasUnsafeToolFinish;

  if (!hasUnsafeToolFinish && choice !== undefined && isPlainObject(choice.delta)) {
    const delta = choice.delta;

    if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
      throw invalidToolCallError();
    }

    const reasoning = stringFrom(delta.reasoning) ?? stringFrom(delta.reasoning_content);

    if (reasoning !== undefined && reasoning.length > 0) {
      const event: CompletionModelStreamEvent = { type: "reasoning_delta", delta: reasoning };

      if (reasoningId !== undefined) {
        event.id = reasoningId;
      }

      events.push(event);
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      events.push({ type: "text_delta", delta: delta.content });
    }

    if (typeof delta.refusal === "string" && delta.refusal.length > 0) {
      events.push({ type: "text_delta", delta: delta.refusal });
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const toolCall of toolCalls) {
      if (!isPlainObject(toolCall)) {
        throw invalidToolCallError();
      }

      hasToolCalls = true;

      if (!isPlainObject(toolCall.function)) {
        throw invalidToolCallError(toolCall.id);
      }

      assertFunctionToolCallType(toolCall.type, toolCall.id, undefined, true);
      const fn = toolCall.function;
      assertOptionalToolCallString(toolCall.id);
      assertOptionalToolCallString(fn.name);
      const index = toolCallIndex(toolCall.index);
      const id = `tool_${index}`;
      assertOptionalToolArguments(id, fn.arguments);
      events.push(
        toolCallDelta(id, {
          callId: stringFrom(toolCall.id),
          name: stringFrom(fn.name),
          argumentsDelta: stringFrom(fn.arguments),
          omitEmptyIdentity: true,
        }),
      );
    }
  }

  if (typeof chunk.id === "string") {
    events.push({ type: "message_id", id: chunk.id });
  }

  if (isPlainObject(chunk.usage)) {
    const response: CompletionResponse = {
      choice: [],
      usage: usageFromOpenAIChatCompletion(chunk.usage),
      rawResponse: chunk,
    };

    if (typeof chunk.id === "string") {
      response.messageId = chunk.id;
    }

    events.push({ type: "final", response });
  }

  const mapping: ChatCompletionStreamChunkMapping = {
    events,
    hasToolCalls,
    hasFinishReason: choice !== undefined && isTerminalFinishReason(choice.finish_reason),
    hasChoices: Array.isArray(chunk.choices) && chunk.choices.length > 0,
    hasPrimaryChoice: choice !== undefined,
  };

  if (mapping.hasFinishReason) {
    mapping.finishReason = choice?.finish_reason;
    for (const event of mapping.events) {
      if (event.type === "final") {
        applyOpenAIChatFinishReason(event.response, mapping.finishReason);
      }
    }
  }

  return mapping;
}

export class OpenAIChatCompletionStreamState {
  private readonly reasoningId = crypto.randomUUID();
  private readonly toolCalls = new Map<string, StreamedChatToolCall>();
  private readonly toolCallIdsByCallId = new Map<string, string>();
  private hasToolCalls = false;
  private hasFinishReason = false;
  private hasChoices = false;
  private hasPrimaryChoice = false;
  private finalResponse: CompletionResponse | undefined;
  private finishReason: unknown;
  private terminalChunk: unknown;

  mapChunk(chunk: unknown): ChatCompletionStreamChunkMapping {
    const mapping = mapOpenAIChatCompletionStreamChunk(chunk, this.reasoningId, {
      deferUnsafeToolFinish: true,
    });
    this.accept(mapping, chunk);

    if (this.hasFinishReason) {
      for (const event of mapping.events) {
        if (event.type === "final") {
          applyOpenAIChatFinishReason(event.response, this.finishReason);
        }
      }
    }

    return mapping;
  }

  private accept(mapping: ChatCompletionStreamChunkMapping, chunk: unknown): void {
    const hasSemanticProgress = mapping.events.some(
      (event) =>
        event.type === "text_delta" ||
        event.type === "reasoning_delta" ||
        event.type === "tool_call_delta" ||
        event.type === "tool_call" ||
        event.type === "source" ||
        event.type === "provider_tool_call",
    );

    if (this.hasFinishReason && hasSemanticProgress) {
      throw invalidToolCallError();
    }

    this.hasToolCalls ||= mapping.hasToolCalls;
    this.hasChoices ||= mapping.hasChoices;
    this.hasPrimaryChoice ||= mapping.hasPrimaryChoice;
    for (const event of mapping.events) {
      if (event.type === "tool_call_delta") this.acceptToolCallDelta(event);

      if (event.type === "final") {
        this.finalResponse = event.response;
      }
    }

    if (!mapping.hasFinishReason) {
      return;
    }

    if (this.hasFinishReason && mapping.finishReason !== this.finishReason) {
      throw invalidToolCallError(undefined, this.errorUsage());
    }

    this.hasFinishReason = true;
    this.finishReason = mapping.finishReason;
    this.terminalChunk = chunk;
  }

  finalEvent(): Extract<CompletionModelStreamEvent, { type: "final" }> | undefined {
    if (!this.hasFinishReason && this.finalResponse === undefined) return undefined;

    const response: CompletionResponse = this.finalResponse ?? {
      choice: [],
      usage: Usage.empty(),
      rawResponse: this.terminalChunk,
    };
    applyOpenAIChatFinishReason(response, this.finishReason);

    if (isPlainObject(this.terminalChunk) && typeof this.terminalChunk.id === "string") {
      response.messageId = this.terminalChunk.id;
    }

    return { type: "final", response };
  }

  assertComplete(): void {
    if (this.hasChoices && !this.hasPrimaryChoice) {
      throw invalidToolCallError(undefined, this.errorUsage());
    }

    if (!this.hasToolCalls) {
      return;
    }

    if (!this.hasFinishReason) {
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        usage: this.errorUsage(),
      });
    }

    this.assertSupportedFinishReason();
    for (const toolCall of this.toolCalls.values()) {
      if (toolCall.callId === undefined || toolCall.name === undefined) {
        throw new CompletionProviderOutputError({
          kind: "incomplete-tool-call",
          toolCallId: toolCall.id,
          usage: this.errorUsage(),
        });
      }

      parseToolArguments(toolCall.id, toolCall.argumentsText, this.errorUsage());
    }
  }

  private assertSupportedFinishReason(): void {
    if (this.finishReason === "length") {
      throw new CompletionProviderOutputError({
        kind: "truncated-tool-call",
        finishReason: "length",
        usage: this.errorUsage(),
      });
    }

    if (this.finishReason === "content_filter") {
      throw new CompletionProviderOutputError({
        kind: "filtered-tool-call",
        finishReason: "content-filter",
        usage: this.errorUsage(),
      });
    }

    if (
      this.finishReason !== "tool_calls" &&
      this.finishReason !== "stop" &&
      this.finishReason !== "function_call"
    ) {
      throw invalidToolCallError(undefined, this.errorUsage());
    }
  }

  private acceptToolCallDelta(
    event: Extract<CompletionModelStreamEvent, { type: "tool_call_delta" }>,
  ): void {
    const existing = this.toolCalls.get(event.id);
    const toolCall = existing ?? { id: event.id, argumentsText: "" };

    if (event.callId !== undefined) {
      if (!isNonblankString(event.callId)) throw invalidToolCallError(event.id, this.errorUsage());

      if (toolCall.callId !== undefined && toolCall.callId !== event.callId) {
        throw invalidToolCallError(event.id, this.errorUsage());
      }

      const existingId = this.toolCallIdsByCallId.get(event.callId);

      if (existingId !== undefined && existingId !== event.id) {
        throw invalidToolCallError(event.id, this.errorUsage());
      }

      toolCall.callId = event.callId;
      this.toolCallIdsByCallId.set(event.callId, event.id);
    }

    if (event.name !== undefined) {
      if (!isNonblankString(event.name)) throw invalidToolCallError(event.id, this.errorUsage());

      if (toolCall.name !== undefined && toolCall.name !== event.name) {
        throw invalidToolCallError(event.id, this.errorUsage());
      }

      toolCall.name = event.name;
    }

    if (event.argumentsDelta !== undefined) toolCall.argumentsText += event.argumentsDelta;

    this.toolCalls.set(event.id, toolCall);
  }

  private errorUsage(): Usage | undefined {
    return this.finalResponse?.usage;
  }
}
