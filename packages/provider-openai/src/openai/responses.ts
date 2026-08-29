import type { ModelContextLimits } from "@anvia/core/completion";
import {
  type AssistantContentPart,
  assertCompletionRequestSupported,
  type CompletionFinishReason,
  type CompletionModelCapabilities,
  type CompletionModelControls,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionSource,
  type FilePart,
  type ImagePart,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type ProviderTool,
  type ProviderToolCall,
  type ReasoningDetail,
  type ReasoningPart,
  type StreamingCompletionModel,
  type ToolCallPart,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultContentPart,
  type ToolResultPart,
  type Usage,
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

type ResponsesCreateParams = Record<string, unknown>;
type ResponsesInputItem = Record<string, unknown>;

export class OpenAIResponsesCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider = "openai";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
  };

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAICompletionModelId,
    readonly contextLimits?: ModelContextLimits,
    readonly controls?: Controls,
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
    const params = toOpenAIResponsesParams(this.modelId, request);
    if (options.stream === true) {
      params.stream = true;
    }
    return providerRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toOpenAIResponsesParams(this.modelId, request);
    const response = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    return withContextUsage(fromOpenAIResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = { ...toOpenAIResponsesParams(this.modelId, request), stream: true };
    const stream = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    const streamState = new OpenAIResponsesStreamState();
    for await (const event of stream as unknown as AsyncIterable<unknown>) {
      const mapped = streamState.mapEvent(event);
      if (mapped !== undefined) {
        yield mapped.type === "final"
          ? {
              ...mapped,
              response: withContextUsage(mapped.response, this.modelInfo()),
            }
          : mapped;
        if (mapped.type === "final" || mapped.type === "error") return;
      }
    }
    streamState.assertComplete();
  }
}

export function toOpenAIResponsesParams(
  modelId: OpenAICompletionModelId,
  request: CompletionRequest,
): ResponsesCreateParams {
  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("OpenAI Responses providerOptions must be a JSON object.");
  }
  const providerOptions = request.providerOptions ?? {};
  const reasoning = isPlainObject(providerOptions.reasoning)
    ? { ...providerOptions.reasoning }
    : undefined;
  const reasoningEffort = request.controls?.reasoningEffort;
  const params: ResponsesCreateParams = {
    ...providerOptions,
    model: modelId,
    input: requestMessages(request).flatMap(messageToResponsesInput),
  };
  if (reasoningEffort !== undefined) {
    params.reasoning = { ...reasoning, effort: reasoningEffort };
  }

  delete params.tools;

  if (request.instructions !== undefined) {
    params.instructions = request.instructions;
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    params.max_output_tokens = request.maxTokens;
  }

  if (request.toolChoice !== undefined) {
    params.tool_choice = toolChoiceToOpenAI(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    params.text = {
      format: {
        type: "json_schema",
        name: schemaName(request.outputSchema),
        strict: true,
        schema: request.outputSchema,
      },
    };
  }

  const tools = [
    ...request.tools.map(toolDefinitionToOpenAI),
    ...(request.providerTools ?? []).map(providerToolToOpenAI),
  ];
  if (tools.length > 0) {
    params.tools = tools;
  } else {
    delete params.tools;
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
  params: ResponsesCreateParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  const summarizedTools = Array.isArray(params.tools) ? params.tools : [];
  return compactJsonObject({
    provider: "openai",
    api: "responses",
    stream: options.stream === true,
    model: stringFrom(params.model),
    parameterKeys: Object.keys(params).sort(),
    inputCount: Array.isArray(params.input) ? params.input.length : undefined,
    toolCount: summarizedTools.length,
    toolNames: summarizedTools.flatMap((tool) => {
      if (!isPlainObject(tool)) {
        return [];
      }
      const name = stringFrom(tool.name) ?? stringFrom(tool.type);
      return name === undefined ? [] : [name];
    }),
    hasInstructions: typeof params.instructions === "string" && params.instructions.length > 0,
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
  return orderedRequestMessages(request);
}

export function fromOpenAIResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) throw invalidToolCallError();
  const raw = response;
  const usage = usageFromOpenAIResponse(raw.usage);
  const errorUsage = isPlainObject(raw.usage) ? usage : undefined;
  if (raw.output !== undefined && !Array.isArray(raw.output)) {
    throw invalidOpenAIResponse(errorUsage);
  }
  const output = raw.output ?? [];
  if (output.some((item) => !isPlainObject(item))) {
    throw invalidOpenAIResponse(errorUsage);
  }
  const choice: AssistantContentPart[] = [];
  const providerToolCalls: ProviderToolCall[] = [];
  const hasFunctionCalls = output.some(
    (item) => isPlainObject(item) && item.type === "function_call",
  );
  assertOpenAIResponseStatus(raw.status, hasFunctionCalls, errorUsage);
  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyOpenAIResponseFinishReason(result, raw, hasFunctionCalls);
  assertSafeOpenAIResponseToolFinishReason(result, hasFunctionCalls, errorUsage);

  for (const item of output) {
    if (!isPlainObject(item)) {
      continue;
    }

    if (item.type === "message") {
      choice.push(...messageOutputToAssistantContent(item));
    }

    if (item.type === "function_call") {
      const { id, callId } = openAIFunctionCallIdentity(item, errorUsage);
      assertCompletedFunctionCallStatus(item.status, id, errorUsage);
      const name = requiredToolCallString(item.name, id, errorUsage);
      const toolCall: ToolCallPart = {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: parseTerminalToolArguments(id, item.arguments, errorUsage),
        callId,
      };
      choice.push(toolCall);
    }

    if (item.type === "reasoning") {
      choice.push(reasoningItemToAssistantContent(item));
    }

    const providerToolCall = providerToolCallFromOutputItem(item);
    if (providerToolCall !== undefined) {
      providerToolCalls.push(providerToolCall);
    }
  }

  const sources = sourcesFromOpenAIResponse(raw, output);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }
  if (sources.length > 0) {
    result.sources = sources;
  }
  if (providerToolCalls.length > 0) {
    result.providerToolCalls = providerToolCalls;
  }

  return result;
}

function applyOpenAIResponseFinishReason(
  response: CompletionResponse,
  raw: Record<string, unknown>,
  hasToolCalls = response.choice.some((part) => part.type === "tool-call"),
): void {
  const status = stringFrom(raw.status);
  const incompleteDetails = isPlainObject(raw.incomplete_details) ? raw.incomplete_details : {};
  const incompleteReason = stringFrom(incompleteDetails.reason);
  let finishReason: CompletionFinishReason;
  if (status === "incomplete") {
    if (incompleteReason === "max_output_tokens") {
      finishReason = "length";
    } else if (incompleteReason === "content_filter") {
      finishReason = "content-filter";
    } else {
      finishReason = "other";
    }
  } else if (status === "completed") {
    finishReason = hasToolCalls ? "tool-calls" : "stop";
  } else if (status === undefined && !hasToolCalls) {
    return;
  } else {
    finishReason = "other";
  }
  response.finishReason = finishReason;
  const providerFinishReason = incompleteReason ?? status;
  if (providerFinishReason !== undefined) {
    response.providerFinishReason = providerFinishReason;
  }
}

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
    const name = requiredToolCallString(event.name, id);
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

class OpenAIResponsesStreamState {
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
      const name = requiredToolCallString(event.name, id);
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

function assertSafeOpenAIResponseToolFinishReason(
  response: CompletionResponse,
  hasToolCalls: boolean,
  usage: Usage | undefined,
): void {
  if (!hasToolCalls) return;
  if (response.finishReason === undefined) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }
  if (response.finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }
  if (response.finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }
  if (response.finishReason === "other") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }
}

function requiredToolCallString(value: unknown, toolCallId?: unknown, usage?: Usage): string {
  if (!isNonblankString(value)) throw invalidToolCallError(toolCallId, usage);
  return value;
}

function openAIFunctionCallIdentity(
  item: Record<string, unknown>,
  usage?: Usage,
): Readonly<{ id: string; callId: string }> {
  const callId = requiredToolCallString(item.call_id, item.id, usage);
  const id = item.id === undefined ? callId : requiredToolCallString(item.id, callId, usage);
  return { id, callId };
}

function assertOpenAIResponseStatus(
  value: unknown,
  hasFunctionCalls: boolean,
  usage?: Usage,
): void {
  if (value === undefined || value === "completed" || value === "incomplete") return;
  if (hasFunctionCalls) return;
  throw invalidOpenAIResponse(usage);
}

function invalidOpenAIResponse(usage?: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({ kind: "invalid-response", usage });
}

function assertCompletedFunctionCallStatus(
  value: unknown,
  toolCallId: string,
  usage?: Usage,
): void {
  if (value === undefined || value === "completed") return;
  if (value === "in_progress" || value === "incomplete") {
    throw new CompletionProviderOutputError({
      kind: "incomplete-tool-call",
      toolCallId,
      usage,
    });
  }
  throw invalidToolCallError(toolCallId, usage);
}

function requiredTerminalArguments(toolCallId: string, value: unknown, usage?: Usage): string {
  if (typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: value === undefined ? "incomplete-tool-call" : "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return value;
}

function parseTerminalToolArguments(toolCallId: string, value: unknown, usage?: Usage): JsonValue {
  return parseToolArguments(toolCallId, requiredTerminalArguments(toolCallId, value, usage), usage);
}

function invalidToolCallError(toolCallId?: unknown, usage?: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId: isNonblankString(toolCallId) ? toolCallId : undefined,
    usage,
  });
}

function invalidToolArgumentsError(
  toolCallId: string,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-arguments",
    toolCallId,
    usage,
  });
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

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function usageFromOpenAIResponse(usage: unknown) {
  const usageSource = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(usageSource.input_tokens);
  const outputTokens = numberFrom(usageSource.output_tokens);
  const inputDetails = isPlainObject(usageSource.input_tokens_details)
    ? usageSource.input_tokens_details
    : {};
  const outputDetails = isPlainObject(usageSource.output_tokens_details)
    ? usageSource.output_tokens_details
    : {};
  return normalizeOpenAIUsage({
    inputTokens,
    outputTokens,
    cachedInputTokens: numberFrom(inputDetails.cached_tokens),
    reasoningOutputTokens: numberFrom(outputDetails.reasoning_tokens),
  });
}

function messageToResponsesInput(message: MessageType): ResponsesInputItem[] {
  if (message.role === "system") {
    return [
      {
        role: "system",
        content: message.content,
      },
    ];
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const inputContent: ResponsesInputItem[] = [];

    for (const content of message.content) {
      inputContent.push(...userContentToOpenAIResponsesParts(content));
    }

    if (inputContent.length === 1 && inputContent[0]?.type === "input_text") {
      return [{ role: "user", content: inputContent[0].text }];
    } else if (inputContent.length > 0) {
      return [{ role: "user", content: inputContent }];
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
      return toolContentToOpenAIResponsesItem(content);
    });
  }

  const items: ResponsesInputItem[] = [];
  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  if (text.length > 0) {
    items.push({ role: "assistant", content: text });
  }

  for (const content of message.content) {
    if (content.type === "reasoning" && content.id !== undefined) {
      items.push(reasoningToOpenAIInput(content));
    }
    if (content.type === "tool-call") {
      items.push({
        type: "function_call",
        id: content.toolCallId,
        call_id: content.callId ?? content.toolCallId,
        name: content.toolName,
        arguments: JSON.stringify(content.input),
      });
    }
    if (content.type === "image" || content.type === "file") {
      throw new Error(
        "OpenAI Responses does not support image or file content in assistant history",
      );
    }
  }

  return items;
}

function toolContentToOpenAIResponsesItem(content: ToolResultPart): ResponsesInputItem {
  return {
    type: "function_call_output",
    call_id: content.callId ?? content.toolCallId,
    output: toolResultToOpenAIResponsesOutput(content),
  };
}

function toolResultContentToOpenAIResponsesOutput(
  content: readonly ToolResultContentPart[],
): string | ResponsesInputItem[] {
  if (content.every((item) => item.type === "text")) {
    return content.map((item) => item.text).join("\n");
  }

  return content.map((item) => {
    if (item.type === "text") {
      return { type: "input_text", text: item.text };
    }
    return fileToOpenAIResponsesPart(item);
  });
}

function toolResultToOpenAIResponsesOutput(content: ToolResultPart): string | ResponsesInputItem[] {
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
  return toolResultContentToOpenAIResponsesOutput(output.value);
}

function reasoningItemToAssistantContent(item: Record<string, unknown>): ReasoningPart {
  const content = reasoningContentFromOpenAIItem(item);
  const id = stringFrom(item.id);
  const text = content
    .flatMap((detail) => (detail.type === "text" || detail.type === "summary" ? [detail.text] : []))
    .join("");
  let reasoning: ReasoningPart = {
    type: "reasoning",
    text,
  };
  if (id !== undefined) reasoning = { ...reasoning, id };
  if (content.length > 0) reasoning = { ...reasoning, details: content };
  return reasoning;
}

function reasoningContentFromOpenAIItem(item: Record<string, unknown>): ReasoningDetail[] {
  const content: ReasoningDetail[] = [];
  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (!isPlainObject(part)) {
        continue;
      }
      if (part.type === "reasoning_text" && typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
      }
    }
  }
  if (Array.isArray(item.summary)) {
    for (const summary of item.summary) {
      if (!isPlainObject(summary)) {
        continue;
      }
      if (typeof summary.text === "string") {
        content.push({ type: "summary", text: summary.text });
      }
    }
  }
  if (typeof item.encrypted_content === "string") {
    content.push({ type: "encrypted", data: item.encrypted_content });
  }
  return content;
}

function reasoningToOpenAIInput(reasoning: ReasoningPart): ResponsesInputItem {
  const item: ResponsesInputItem = {
    type: "reasoning",
    id: reasoning.id,
    summary:
      reasoning.details
        ?.filter((content): content is Extract<ReasoningDetail, { type: "summary" }> => {
          return content.type === "summary";
        })
        .map((content) => ({ type: "summary_text", text: content.text })) ?? [],
  };
  const textContent = reasoning.details?.flatMap((content) =>
    content.type === "text" ? [{ type: "reasoning_text", text: content.text }] : [],
  );
  if (textContent !== undefined && textContent.length > 0) {
    item.content = textContent;
  }
  const encrypted = reasoning.details?.find((content) => content.type === "encrypted");
  if (encrypted?.type === "encrypted") {
    item.encrypted_content = encrypted.data;
  }
  return item;
}

function userContentToOpenAIResponsesParts(content: UserContentPart): ResponsesInputItem[] {
  if (content.type === "text") {
    return [{ type: "input_text", text: content.text }];
  }

  if (content.type === "image") {
    const part: ResponsesInputItem = { type: "input_image", image_url: imageUrl(content) };
    if (content.detail !== undefined) {
      part.detail = content.detail;
    }
    return [part];
  }

  if (content.type === "file") {
    return [fileToOpenAIResponsesPart(content)];
  }

  return [];
}

function imageUrl(image: ImagePart): string {
  if (image.image.type === "url") {
    return image.image.url;
  }

  if (image.mediaType === undefined) {
    throw new Error("OpenAI Responses image data requires mediaType");
  }
  return `data:${image.mediaType};base64,${image.image.data}`;
}

function fileToOpenAIResponsesPart(file: FilePart): ResponsesInputItem {
  if (file.data.type === "text") {
    return { type: "input_text", text: file.data.text };
  }

  if (file.mediaType.startsWith("image/")) {
    return {
      type: "input_image",
      image_url:
        file.data.type === "url"
          ? file.data.url
          : `data:${file.mediaType};base64,${file.data.data}`,
      detail: "auto",
    };
  }

  if (file.mediaType !== "application/pdf") {
    throw new Error("OpenAI Responses only supports image and PDF file attachments");
  }

  if (file.data.type === "url") {
    return { type: "input_file", file_url: file.data.url };
  }

  return {
    type: "input_file",
    file_data: `data:${file.mediaType};base64,${file.data.data}`,
    filename: file.filename ?? "document.pdf",
  };
}

function toolDefinitionToOpenAI(tool: ToolDefinition): ResponsesInputItem {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function providerToolToOpenAI(tool: ProviderTool): ResponsesInputItem {
  return {
    ...tool.configuration,
    type: tool.name,
  };
}

function toolChoiceToOpenAI(toolChoice: ToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "required" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    name: toolChoice.name,
  };
}

function messageOutputToAssistantContent(item: Record<string, unknown>): AssistantContentPart[] {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.flatMap((part): AssistantContentPart[] => {
    if (!isPlainObject(part)) {
      return [];
    }

    if (part.type === "output_text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "refusal" && typeof part.refusal === "string") {
      return [{ type: "text", text: part.refusal }];
    }

    return [];
  });
}

const PROVIDER_TOOL_OUTPUT_TYPES = new Set([
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
  "file_search_call",
  "mcp_call",
]);

function providerToolCallFromOutputItem(
  item: Record<string, unknown>,
): ProviderToolCall | undefined {
  if (typeof item.type !== "string" || !PROVIDER_TOOL_OUTPUT_TYPES.has(item.type)) {
    return undefined;
  }
  const toolCall: ProviderToolCall = {
    id: requiredToolCallString(item.id),
    name: item.type.replace(/_call$/, ""),
  };
  const status = stringFrom(item.status);
  if (status !== undefined) {
    toolCall.status = status;
  }
  const detailEntries = Object.entries(item).filter(
    ([key, value]) => key !== "id" && key !== "type" && key !== "status" && value !== undefined,
  );
  if (detailEntries.length > 0) {
    toolCall.details = compactJsonObject(Object.fromEntries(detailEntries));
  }
  return toolCall;
}

function sourcesFromOpenAIResponse(
  response: Record<string, unknown>,
  output: unknown[],
): CompletionSource[] {
  const sources: CompletionSource[] = [];
  if (Array.isArray(response.citations)) {
    for (const citation of response.citations) {
      if (typeof citation === "string") {
        sources.push({ type: "url", url: citation });
      } else if (isPlainObject(citation)) {
        const source = sourceFromAnnotation(citation);
        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }
  for (const item of output) {
    if (!isPlainObject(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (!isPlainObject(content) || !Array.isArray(content.annotations)) {
        continue;
      }
      for (const annotation of content.annotations) {
        if (!isPlainObject(annotation)) {
          continue;
        }
        const source = sourceFromAnnotation(annotation);
        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }
  return dedupeSources(sources);
}

function sourceFromAnnotation(annotation: Record<string, unknown>): CompletionSource | undefined {
  const url = stringFrom(annotation.url);
  if (url === undefined) {
    return undefined;
  }
  const source: CompletionSource = { type: "url", url };
  const title = stringFrom(annotation.title);
  if (title !== undefined) source.title = title;
  const id = stringFrom(annotation.id);
  if (id !== undefined) source.id = id;
  const startIndex = numberFromOptional(annotation.start_index ?? annotation.startIndex);
  if (startIndex !== undefined) source.startIndex = startIndex;
  const endIndex = numberFromOptional(annotation.end_index ?? annotation.endIndex);
  if (endIndex !== undefined) source.endIndex = endIndex;
  return source;
}

function numberFromOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dedupeSources(sources: CompletionSource[]): CompletionSource[] {
  const urlsWithStructuredSources = new Set(
    sources.flatMap((source) =>
      source.title !== undefined ||
      source.id !== undefined ||
      source.startIndex !== undefined ||
      source.endIndex !== undefined
        ? [source.url]
        : [],
    ),
  );
  const seen = new Set<string>();
  return sources.filter((source) => {
    const isBare =
      source.title === undefined &&
      source.id === undefined &&
      source.startIndex === undefined &&
      source.endIndex === undefined;
    if (isBare && urlsWithStructuredSources.has(source.url)) {
      return false;
    }
    const key = `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toolCallDelta(
  id: string,
  values: {
    callId?: string | undefined;
    name?: string | undefined;
    argumentsDelta?: string | undefined;
    argumentsMode?: "append" | "replace" | undefined;
  },
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  if (values.argumentsMode !== undefined) event.argumentsMode = values.argumentsMode;
  return event;
}

export const openaiMessageHelpers = {
  messageToResponsesInput,
  toolDefinitionToOpenAI,
};
