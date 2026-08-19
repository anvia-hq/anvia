import type { ModelContextLimits } from "@anvia/core/completion";
import {
  type AssistantContentPart,
  assertCompletionRequestSupported,
  type CompletionFinishReason,
  type CompletionModelCapabilities,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
  type CompletionResponse,
  type FilePart,
  type ImagePart,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type StreamingCompletionModel,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultPart,
  Usage,
  type UserContentPart,
  withContextUsage,
} from "@anvia/core/completion";
import type { OpenAI } from "openai";
import { orderedRequestMessages } from "../request-messages";
import {
  isPlainObject,
  normalizeOpenAIUsage,
  numberFrom,
  parseToolArguments,
  schemaName,
  stringFrom,
} from "../utils";
import type { OpenAICompletionModelId } from "./models";

type ChatCompletionParams = Record<string, unknown>;
type ChatMessage = Record<string, unknown>;

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

export class OpenAIChatCompletionModel implements StreamingCompletionModel<unknown> {
  readonly provider = "openai";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: false,
    outputSchema: true,
    reasoning: true,
  };

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAICompletionModelId,
    readonly contextLimits?: ModelContextLimits,
  ) {}

  private modelInfo(): CompletionModelInfo | undefined {
    return this.contextLimits === undefined
      ? undefined
      : { modelId: this.modelId, context: this.contextLimits };
  }

  traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    const params: ChatCompletionParams = toOpenAIChatCompletionParams(this.modelId, request);
    if (options.stream === true) {
      params.stream = true;
      const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
      params.stream_options = { ...streamOptions, include_usage: true };
    }
    return providerRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toOpenAIChatCompletionParams(this.modelId, request);
    const response = await this.client.chat.completions.create(
      params as never,
      openAIRequestOptions(options),
    );
    return withContextUsage(fromOpenAIChatCompletionResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params: ChatCompletionParams = {
      ...toOpenAIChatCompletionParams(this.modelId, request),
      stream: true,
    };
    const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
    params.stream_options = { ...streamOptions, include_usage: true };
    const stream = await this.client.chat.completions.create(
      params as never,
      openAIRequestOptions(options),
    );
    const streamState = new OpenAIChatCompletionStreamState();
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      const mapping = streamState.mapChunk(chunk);
      for (const event of mapping.events) {
        if (event.type !== "final") yield event;
      }
    }
    streamState.assertComplete();
    const finalEvent = streamState.finalEvent();
    if (finalEvent !== undefined) {
      yield {
        ...finalEvent,
        response: withContextUsage(finalEvent.response, this.modelInfo()),
      };
    }
  }
}

export function toOpenAIChatCompletionParams(
  modelId: OpenAICompletionModelId,
  request: CompletionRequest,
): ChatCompletionParams {
  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("OpenAI Chat Completions providerOptions must be a JSON object.");
  }
  const providerOptions = request.providerOptions ?? {};
  const params: ChatCompletionParams = {
    ...providerOptions,
    model: modelId,
    messages: requestMessages(request).flatMap(messageToChatMessages),
  };

  delete params.tools;

  if (request.tools.length > 0) {
    params.tools = request.tools.map(toolDefinitionToOpenAIChatCompletion);
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    params.max_tokens = request.maxTokens;
  }

  if (request.toolChoice !== undefined) {
    params.tool_choice = toolChoiceToOpenAIChatCompletion(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    params.response_format = {
      type: "json_schema",
      json_schema: {
        name: schemaName(request.outputSchema),
        strict: true,
        schema: request.outputSchema,
      },
    };
  }

  return params;
}

function openAIRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  maxRetries: 0;
} {
  return { signal: options?.abortSignal, maxRetries: 0 };
}

function providerRequestSummary(
  params: ChatCompletionParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  return compactJsonObject({
    provider: "openai-chat",
    api: "chat.completions",
    stream: options.stream === true,
    model: stringFrom(params.model),
    parameterKeys: Object.keys(params).sort(),
    messageCount: Array.isArray(params.messages) ? params.messages.length : undefined,
    toolCount: request.tools.length,
    toolNames: request.tools.map((tool) => tool.name),
    hasOutputSchema: request.outputSchema !== undefined,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolChoice: toolChoiceSummary(request.toolChoice),
    providerOptionKeys: isPlainObject(request.providerOptions)
      ? Object.keys(request.providerOptions).sort()
      : undefined,
  });
}

function toolChoiceSummary(toolChoice: ToolChoice | undefined): JsonValue | undefined {
  if (toolChoice === undefined || typeof toolChoice === "string") {
    return toolChoice;
  }
  return { type: toolChoice.type, name: toolChoice.name };
}

function compactJsonObject(values: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!isJsonValue(value)) {
        return [];
      }
      return [[key, value]];
    }),
  ) as JsonObject;
}

function requestMessages(request: CompletionRequest): MessageType[] {
  return orderedRequestMessages(request, { includeInstructionsAsSystem: true });
}

export function fromOpenAIChatCompletionResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) throw invalidToolCallError();
  const raw = response;
  const usage = usageFromOpenAIChatCompletion(raw.usage);
  const errorUsage = isPlainObject(raw.usage) ? usage : undefined;
  const firstChoice = primaryStreamChoice(raw.choices);
  if (firstChoice === undefined || !isPlainObject(firstChoice.message)) {
    throw invalidToolCallError(undefined, errorUsage);
  }
  const message = firstChoice.message;
  const choice: AssistantContentPart[] = [];

  const reasoning = stringFrom(message.reasoning) ?? stringFrom(message.reasoning_content);
  if (reasoning !== undefined && reasoning.length > 0) {
    choice.push({
      type: "reasoning",
      text: reasoning,
      details: [{ type: "text", text: reasoning }],
    });
  }

  if (typeof message.content === "string" && message.content.length > 0) {
    choice.push({ type: "text", text: message.content });
  }

  if (typeof message.refusal === "string" && message.refusal.length > 0) {
    choice.push({ type: "text", text: message.refusal });
  }

  const hasRawToolCall =
    message.tool_calls !== undefined &&
    (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0);
  assertSafeOpenAIChatToolFinishReason(firstChoice?.finish_reason, hasRawToolCall, errorUsage);
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
    throw invalidToolCallError(undefined, errorUsage);
  }
  const toolCalls = message.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    if (!isPlainObject(toolCall)) {
      throw invalidToolCallError(undefined, errorUsage);
    }

    if (!isPlainObject(toolCall.function)) {
      throw invalidToolCallError(toolCall.id, errorUsage);
    }
    assertFunctionToolCallType(toolCall.type, toolCall.id, errorUsage, false);
    const fn = toolCall.function;
    const id = requiredToolCallString(toolCall.id, undefined, errorUsage);
    const name = requiredToolCallString(fn.name, id, errorUsage);
    const input = parseTerminalToolArguments(id, fn.arguments, errorUsage);
    choice.push({
      type: "tool-call",
      toolCallId: id,
      callId: id,
      toolName: name,
      input,
    });
  }

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyOpenAIChatFinishReason(result, firstChoice?.finish_reason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

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

class OpenAIChatCompletionStreamState {
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
        if (this.finalResponse !== undefined) throw invalidToolCallError();
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

function assertSafeOpenAIChatToolFinishReason(
  value: unknown,
  hasToolCalls: boolean,
  usage: Usage | undefined,
): void {
  if (!hasToolCalls) return;
  if (!isTerminalFinishReason(value)) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }
  if (value === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: "length",
      usage,
    });
  }
  if (value === "content_filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason: "content-filter",
      usage,
    });
  }
  if (
    isTerminalFinishReason(value) &&
    value !== "tool_calls" &&
    value !== "stop" &&
    value !== "function_call"
  ) {
    throw invalidToolCallError(undefined, usage);
  }
}

function unsafeOpenAIChatToolFinishError(
  value: unknown,
  usage: Usage | undefined,
): CompletionProviderOutputError {
  if (value === "length") {
    return new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: "length",
      usage,
    });
  }
  return new CompletionProviderOutputError({
    kind: "filtered-tool-call",
    finishReason: "content-filter",
    usage,
  });
}

function applyOpenAIChatFinishReason(response: CompletionResponse, value: unknown): void {
  if (!isTerminalFinishReason(value)) return;
  response.finishReason = openAIChatFinishReason(value);
  if (typeof value === "string") response.providerFinishReason = value;
}

function openAIChatFinishReason(value: unknown): CompletionFinishReason {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls" || value === "function_call") return "tool-calls";
  return "other";
}

function primaryStreamChoice(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isPlainObject)) {
    throw invalidToolCallError();
  }
  const choices = value;
  if (choices.length === 0) {
    return undefined;
  }

  const indexedChoices: Array<{ choice: Record<string, unknown>; index: number }> = [];
  const unindexedChoices: Record<string, unknown>[] = [];
  for (const choice of choices) {
    if (choice.index === undefined) {
      unindexedChoices.push(choice);
      continue;
    }
    if (!isStreamIndex(choice.index)) {
      throw invalidToolCallError();
    }
    indexedChoices.push({ choice, index: choice.index });
  }

  if (unindexedChoices.length > 0) {
    if (indexedChoices.length > 0 || unindexedChoices.length > 1) {
      throw invalidToolCallError();
    }
    return unindexedChoices[0];
  }

  const primaryChoices = indexedChoices.filter(({ index }) => index === 0);
  if (primaryChoices.length > 1) {
    throw invalidToolCallError();
  }
  return primaryChoices[0]?.choice;
}

function toolCallIndex(value: unknown): number {
  if (!isStreamIndex(value)) {
    throw invalidToolCallError();
  }
  return value;
}

function isStreamIndex(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function isTerminalFinishReason(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function requiredToolCallString(value: unknown, toolCallId?: unknown, usage?: Usage): string {
  if (!isNonblankString(value)) {
    throw invalidToolCallError(toolCallId, usage);
  }
  return value;
}

function assertOptionalToolCallString(value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw invalidToolCallError();
  }
}

function assertOptionalToolArguments(toolCallId: string, value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
    });
  }
}

function assertFunctionToolCallType(
  value: unknown,
  toolCallId: unknown,
  usage: Usage | undefined,
  allowMissing: boolean,
): void {
  if (value === "function" || (allowMissing && value === undefined)) return;
  throw invalidToolCallError(toolCallId, usage);
}

function parseTerminalToolArguments(toolCallId: string, value: unknown, usage?: Usage): JsonValue {
  if (typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: value === undefined ? "incomplete-tool-call" : "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return parseToolArguments(toolCallId, value, usage);
}

function invalidToolCallError(toolCallId?: unknown, usage?: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId: isNonblankString(toolCallId) ? toolCallId : undefined,
    usage,
  });
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function usageFromOpenAIChatCompletion(usage: unknown) {
  const usageSource = isPlainObject(usage) ? usage : {};
  const promptDetails = isPlainObject(usageSource.prompt_tokens_details)
    ? usageSource.prompt_tokens_details
    : {};
  const completionDetails = isPlainObject(usageSource.completion_tokens_details)
    ? usageSource.completion_tokens_details
    : {};
  const inputTokens = numberFrom(usageSource.prompt_tokens);
  const outputTokens = numberFrom(usageSource.completion_tokens);
  return normalizeOpenAIUsage({
    inputTokens,
    outputTokens,
    cachedInputTokens: numberFrom(promptDetails.cached_tokens),
    reasoningOutputTokens: numberFrom(completionDetails.reasoning_tokens),
  });
}

function messageToChatMessages(message: MessageType): ChatMessage[] {
  if (message.role === "system") {
    return [{ role: "system", content: message.content }];
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const contentParts: ChatMessage[] = [];

    for (const content of message.content) {
      contentParts.push(...userContentToChatParts(content));
    }

    if (contentParts.length === 1 && contentParts[0]?.type === "text") {
      return [{ role: "user", content: contentParts[0].text }];
    } else if (contentParts.length > 0) {
      return [{ role: "user", content: contentParts }];
    }

    return [];
  }

  if (message.role === "tool") {
    return message.content.map((content) => {
      if (content.type !== "tool-result") {
        throw new TypeError(
          "Anvia interaction responses must be resolved by Agent before provider calls.",
        );
      }
      return toolContentToChatMessage(content);
    });
  }

  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  const reasoning = message.content
    .flatMap((content) => (content.type === "reasoning" ? [content.text] : []))
    .filter((text) => text.length > 0)
    .join("\n");
  if (message.content.some((content) => content.type === "image" || content.type === "file")) {
    throw new Error(
      "OpenAI chat completions does not support image or file content in assistant history",
    );
  }
  const toolCalls = message.content
    .filter((content) => content.type === "tool-call")
    .map((content) => ({
      id: content.callId ?? content.toolCallId,
      type: "function",
      function: {
        name: content.toolName,
        arguments: JSON.stringify(content.input),
      },
    }));

  const chatMessage: ChatMessage = {
    role: "assistant",
  };
  if (text.length > 0) {
    chatMessage.content = text;
  } else if (toolCalls.length === 0) {
    chatMessage.content = " ";
  }
  if (reasoning.length > 0) {
    chatMessage.reasoning_content = reasoning;
  }
  if (toolCalls.length > 0) {
    chatMessage.tool_calls = toolCalls;
  }

  return [chatMessage];
}

function toolContentToChatMessage(content: ToolResultPart): ChatMessage {
  return {
    role: "tool",
    tool_call_id: content.callId ?? content.toolCallId,
    content: toolResultToText(content),
  };
}

function userContentToChatParts(content: UserContentPart): ChatMessage[] {
  if (content.type === "text") {
    return [{ type: "text", text: content.text }];
  }

  if (content.type === "image") {
    const image_url: ChatMessage = { url: imageUrl(content) };
    if (content.detail !== undefined) {
      image_url.detail = content.detail;
    }
    return [{ type: "image_url", image_url }];
  }

  if (content.type === "file") {
    return fileToChatParts(content);
  }

  return [];
}

function imageUrl(image: ImagePart): string {
  if (image.image.type === "url") {
    return image.image.url;
  }

  if (image.mediaType === undefined) {
    throw new Error("OpenAI chat image data requires mediaType");
  }
  return `data:${image.mediaType};base64,${image.image.data}`;
}

function fileToChatParts(file: FilePart): ChatMessage[] {
  if (file.data.type === "text") {
    return [{ type: "text", text: file.data.text }];
  }

  throw new Error("OpenAI chat completions does not support file attachments");
}

function toolResultToText(content: ToolResultPart): string {
  const output = content.output;
  if (output.type === "text" || output.type === "error-text") {
    return output.value;
  }
  if (output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value);
  }
  if (output.type === "execution-denied") {
    return output.reason ?? "Tool execution was denied.";
  }
  return output.value
    .map((part) => (part.type === "text" ? part.text : `[file:${part.mediaType}]`))
    .join("\n");
}

function toolDefinitionToOpenAIChatCompletion(tool: ToolDefinition): ChatMessage {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toolChoiceToOpenAIChatCompletion(toolChoice: ToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "required" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: toolChoice.name,
    },
  };
}

function toolCallDelta(
  id: string,
  values: {
    callId?: string | undefined;
    name?: string | undefined;
    argumentsDelta?: string | undefined;
  },
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined && values.callId.length > 0) event.callId = values.callId;
  if (values.name !== undefined && values.name.length > 0) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const openAIChatCompletionMessageHelpers = {
  messageToChatMessages,
  toolDefinitionToOpenAIChatCompletion,
};
