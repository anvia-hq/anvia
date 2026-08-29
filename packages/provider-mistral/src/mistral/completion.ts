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
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type NoCompletionModelControls,
  type StreamingCompletionModel,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultPart,
  Usage,
  type UserContentPart,
  withContextUsage,
} from "@anvia/core/completion";
import type { Mistral } from "@mistralai/mistralai";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, parseToolArguments, schemaName, stringFrom } from "../utils";
import type { MistralCompletionModelId } from "./models";

type MistralChatParams = Record<string, unknown>;
type MistralChatMessage = Record<string, unknown>;

export class MistralCompletionModel implements StreamingCompletionModel<
  unknown,
  NoCompletionModelControls
> {
  readonly provider = "mistral";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: true,
    reasoning: false,
  };

  constructor(
    private readonly client: Mistral,
    readonly modelId: MistralCompletionModelId,
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
    const params = toMistralChatParams(this.modelId, request);
    return providerRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toMistralChatParams(this.modelId, request);
    const response = await this.client.chat.complete(
      params as never,
      mistralRequestOptions(options) as never,
    );
    return withContextUsage(fromMistralChatResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = toMistralChatParams(this.modelId, request);
    const stream = await this.client.chat.stream(
      params as never,
      mistralRequestOptions(options) as never,
    );
    let providerFinishReason: string | undefined;
    let finalResponse: CompletionResponse | undefined;
    let lastChunk: unknown;
    let sawAnyChoice = false;
    let sawPrimaryChoice = false;
    let sawToolProgress = false;
    for await (const completionEvent of stream as unknown as AsyncIterable<unknown>) {
      const chunk = mistralCompletionEventData(completionEvent);
      lastChunk = chunk;
      const metadata = mistralStreamChunkMetadata(chunk);
      const chunkFinishReason = finishReasonFromChoice(metadata.primaryChoice);
      const errorUsage = metadata.usage ?? finalResponse?.usage;

      sawAnyChoice ||= metadata.hasChoices;
      sawPrimaryChoice ||= metadata.primaryChoice !== undefined;

      const hasSemanticProgress = hasRawMistralSemanticProgress(metadata.primaryChoice);
      if (providerFinishReason !== undefined && hasSemanticProgress) {
        throw invalidMistralToolCall(undefined, errorUsage);
      }
      if (chunkFinishReason !== undefined) {
        if (providerFinishReason !== undefined && providerFinishReason !== chunkFinishReason) {
          throw invalidMistralToolCall(undefined, errorUsage);
        }
        providerFinishReason = chunkFinishReason;
      }

      const events = fromMistralChatStreamChunk(chunk);
      for (const event of events) {
        if (event.type === "final") {
          finalResponse = event.response;
          continue;
        }
        if (event.type === "tool_call_delta" || event.type === "tool_call") {
          sawToolProgress = true;
        }
        yield event;
      }
    }
    if (!sawPrimaryChoice) {
      if (sawAnyChoice) {
        throw invalidMistralToolCall(undefined, finalResponse?.usage);
      }
      throw new CompletionProviderOutputError({
        kind: "incomplete-stream",
        usage: finalResponse?.usage,
      });
    }
    if (sawToolProgress && providerFinishReason === undefined) {
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        usage: finalResponse?.usage,
      });
    }
    if (finalResponse === undefined && providerFinishReason !== undefined) {
      finalResponse = {
        choice: [],
        usage: Usage.empty(),
        rawResponse: lastChunk,
      };
    }
    if (finalResponse !== undefined) {
      applyMistralFinishReason(finalResponse, providerFinishReason);
      if (sawToolProgress) {
        assertSafeToolCallFinish(1, finalResponse.finishReason, finalResponse.usage);
      }
      yield {
        type: "final",
        response: withContextUsage(finalResponse, this.modelInfo()),
      };
    }
  }
}

function mistralCompletionEventData(event: unknown): Record<string, unknown> {
  if (!isPlainObject(event) || !isPlainObject(event.data)) {
    throw invalidMistralToolCall(undefined);
  }
  return event.data;
}

export function toMistralChatParams(
  modelId: MistralCompletionModelId,
  request: CompletionRequest,
): MistralChatParams {
  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("Mistral providerOptions must be a JSON object.");
  }
  const providerOptions = request.providerOptions ?? {};
  const params: MistralChatParams = {
    ...providerOptions,
    model: modelId,
    messages: requestMessages(request).flatMap(messageToMistralMessages),
  };

  delete params.tools;

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    params.maxTokens = request.maxTokens;
  }

  if (request.tools.length > 0) {
    params.tools = request.tools.map(toolDefinitionToMistral);
  }

  if (request.toolChoice !== undefined) {
    params.toolChoice = toolChoiceToMistral(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    params.responseFormat = {
      type: "json_schema",
      jsonSchema: {
        name: schemaName(request.outputSchema),
        strict: true,
        schema: request.outputSchema,
      },
    };
  }

  return params;
}

function mistralRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  retries: { strategy: "none" };
} {
  return { signal: options?.abortSignal, retries: { strategy: "none" } };
}

function providerRequestSummary(
  params: MistralChatParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  return compactJsonObject({
    provider: "mistral",
    api: options.stream === true ? "chat.stream" : "chat.complete",
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

export function fromMistralChatResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  const raw = response;
  const usage = usageFromMistral(raw.usage);
  const primaryChoice = primaryMistralChoice(raw.choices, usage);
  const message = isPlainObject(primaryChoice?.message) ? primaryChoice.message : {};
  const providerFinishReason = finishReasonFromChoice(primaryChoice);
  const finishReason =
    providerFinishReason === undefined ? undefined : mistralFinishReason(providerFinishReason);
  const choice: AssistantContentPart[] = [];

  const text = stringContent(message.content);
  if (text !== undefined && text.length > 0) {
    choice.push({ type: "text", text });
  }

  const rawToolCalls = message.toolCalls ?? message.tool_calls;
  assertSafeToolCallFinish(hasRawToolCallValue(rawToolCalls) ? 1 : 0, finishReason, usage);
  const toolCalls = toolCallsFrom(message, usage);
  for (const [index, toolCall] of toolCalls.entries()) {
    if (!isPlainObject(toolCall.function)) {
      throw invalidMistralToolCall(undefined, usage);
    }
    assertMistralFunctionToolCall(toolCall, usage);
    const fn = toolCall.function;
    const id =
      optionalMistralToolCallId(toolCall.id, usage) ?? deterministicToolCallId(raw.id, index);
    if (!isNonblankString(id) || !isNonblankString(fn.name)) {
      throw invalidMistralToolCall(isNonblankString(id) ? id : undefined, usage);
    }
    const args = parseToolArgumentsValue(id, fn.arguments, usage);
    choice.push({
      type: "tool-call",
      toolCallId: id,
      callId: id,
      toolName: fn.name,
      input: args,
    });
  }

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyMistralFinishReason(result, providerFinishReason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function fromMistralChatStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  if (!isPlainObject(chunk)) {
    throw invalidMistralToolCall(undefined);
  }

  const events: CompletionModelStreamEvent[] = [];
  const usage = isPlainObject(chunk.usage) ? usageFromMistral(chunk.usage) : undefined;
  if (chunk.choices === undefined) {
    throw invalidMistralToolCall(undefined, usage);
  }
  const choice = primaryMistralChoice(chunk.choices, usage, { allowMissingPrimary: true });
  const providerFinishReason = finishReasonFromChoice(choice);
  const finishReason =
    providerFinishReason === undefined ? undefined : mistralFinishReason(providerFinishReason);
  if (hasRawMistralToolCalls(choice) && finishReason !== undefined) {
    assertSafeToolCallFinish(1, finishReason, usage);
  }

  if (choice?.delta !== undefined && !isPlainObject(choice.delta)) {
    throw invalidMistralToolCall(undefined, usage);
  }
  if (choice !== undefined && isPlainObject(choice.delta)) {
    const delta = choice.delta;
    const content = stringContent(delta.content);
    if (content !== undefined && content.length > 0) {
      events.push({ type: "text_delta", delta: content });
    }

    for (const toolCall of toolCallsFrom(delta, usage)) {
      if (!isPlainObject(toolCall.function)) {
        throw invalidMistralToolCall(undefined, usage);
      }
      assertMistralFunctionToolCall(toolCall, usage);
      const fn = toolCall.function;
      const index = mistralToolCallIndex(toolCall.index, usage);
      const callId = optionalMistralToolCallId(toolCall.id, usage);
      const name = optionalMistralToolCallName(fn.name, usage);
      const argumentsValue = mistralStreamToolArguments(fn.arguments, callId, usage);
      events.push(
        toolCallDelta(`tool_${index}`, {
          callId,
          name,
          argumentsDelta: argumentsValue.text,
          argumentsMode: argumentsValue.mode,
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
      usage: usageFromMistral(chunk.usage),
      rawResponse: chunk,
    };
    if (typeof chunk.id === "string") {
      response.messageId = chunk.id;
    }
    applyMistralFinishReason(response, providerFinishReason);
    events.push({ type: "final", response });
  }

  return events;
}

type MistralStreamChunkMetadata = Readonly<{
  usage: Usage | undefined;
  hasChoices: boolean;
  primaryChoice: Record<string, unknown> | undefined;
}>;

function mistralStreamChunkMetadata(value: unknown): MistralStreamChunkMetadata {
  if (!isPlainObject(value)) {
    throw invalidMistralToolCall(undefined);
  }
  const usage = isPlainObject(value.usage) ? usageFromMistral(value.usage) : undefined;
  if (value.choices === undefined) {
    throw invalidMistralToolCall(undefined, usage);
  }
  const primaryChoice = primaryMistralChoice(value.choices, usage, {
    allowMissingPrimary: true,
  });
  return {
    usage,
    hasChoices: Array.isArray(value.choices) && value.choices.length > 0,
    primaryChoice,
  };
}

function hasRawMistralSemanticProgress(choice: Record<string, unknown> | undefined): boolean {
  if (choice?.delta === undefined) return false;
  if (!isPlainObject(choice.delta)) return true;
  const content = stringContent(choice.delta.content);
  return (content !== undefined && content.length > 0) || hasRawMistralToolCalls(choice);
}

function hasRawMistralToolCalls(choice: Record<string, unknown> | undefined): boolean {
  if (!isPlainObject(choice?.delta)) return false;
  const raw = choice.delta.toolCalls ?? choice.delta.tool_calls;
  return hasRawToolCallValue(raw);
}

function hasRawToolCallValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

function applyMistralFinishReason(response: CompletionResponse, value: string | undefined): void {
  if (value === undefined) return;
  response.finishReason = mistralFinishReason(value);
  response.providerFinishReason = value;
}

function mistralFinishReason(value: string): CompletionFinishReason {
  if (value === "stop") return "stop";
  if (value === "length" || value === "model_length") return "length";
  if (value === "content_filter" || value === "safety") return "content-filter";
  if (value === "tool_calls" || value === "function_call") return "tool-calls";
  return "other";
}

function usageFromMistral(usage: unknown): Usage {
  const raw = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(raw.promptTokens) || numberFrom(raw.prompt_tokens);
  const outputTokens = numberFrom(raw.completionTokens) || numberFrom(raw.completion_tokens);
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    details: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
    },
  };
}

function messageToMistralMessages(message: MessageType): MistralChatMessage[] {
  if (message.role === "system") {
    return [{ role: "system", content: message.content }];
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const contentParts: string[] = [];

    for (const content of message.content) {
      contentParts.push(...userContentToMistralText(content));
    }

    const text = contentParts.join("\n");
    if (text.length > 0) {
      return [{ role: "user", content: text }];
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
      return toolContentToMistralMessage(content);
    });
  }

  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  if (message.content.some((content) => content.type === "image" || content.type === "file")) {
    throw new Error("Mistral chat does not support image or file content in assistant history");
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

  const chatMessage: MistralChatMessage = {
    role: "assistant",
  };
  if (text.length > 0) {
    chatMessage.content = text;
  }
  if (toolCalls.length > 0) {
    chatMessage.toolCalls = toolCalls;
  }

  return [chatMessage];
}

function toolContentToMistralMessage(content: ToolResultPart): MistralChatMessage {
  return {
    role: "tool",
    toolCallId: content.callId ?? content.toolCallId,
    name: content.toolName,
    content: toolResultToMistralText(content),
  };
}

function userContentToMistralText(content: UserContentPart): string[] {
  if (content.type === "text") {
    return [content.text];
  }

  if (content.type === "image") {
    throw new Error("Mistral image inputs are not supported yet");
  }

  if (content.type === "file") {
    return documentToMistralText(content);
  }

  return [];
}

function documentToMistralText(document: FilePart): string[] {
  if (document.data.type === "text") {
    return [document.data.text];
  }

  throw new Error("Mistral document inputs are not supported yet");
}

function toolResultToMistralText(content: ToolResultPart): string {
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
    .map((item) => (item.type === "text" ? item.text : `[file:${item.mediaType}]`))
    .join("\n");
}

function toolDefinitionToMistral(tool: ToolDefinition): MistralChatMessage {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toolChoiceToMistral(toolChoice: ToolChoice): unknown {
  if (toolChoice === "required") {
    return "any";
  }

  if (toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: toolChoice.name,
    },
  };
}

function toolCallsFrom(message: Record<string, unknown>, usage?: Usage): Record<string, unknown>[] {
  const raw = message.toolCalls ?? message.tool_calls;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((toolCall) => !isPlainObject(toolCall))) {
    throw invalidMistralToolCall(undefined, usage);
  }
  return raw;
}

function stringContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .flatMap((part) => {
        if (!isPlainObject(part)) {
          return [];
        }
        return typeof part.text === "string" ? [part.text] : [];
      })
      .join("");
    return text.length > 0 ? text : undefined;
  }

  return undefined;
}

function parseToolArgumentsValue(toolCallId: string, args: unknown, usage: Usage): JsonValue {
  if (typeof args === "string") {
    return parseToolArguments(toolCallId, args, usage);
  }
  if (!isPlainObject(args) || !isJsonValue(args)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return args;
}

function deterministicToolCallId(responseId: unknown, index: number): string {
  const prefix = typeof responseId === "string" && responseId.length > 0 ? responseId : "mistral";
  return `${prefix}-tool-${index.toString()}`;
}

function primaryMistralChoice(
  value: unknown,
  usage?: Usage,
  options: Readonly<{ allowMissingPrimary?: boolean }> = {},
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw invalidMistralToolCall(undefined, usage);
  }
  const choices = value.filter(isPlainObject);
  if (choices.length !== value.length) {
    throw invalidMistralToolCall(undefined, usage);
  }
  if (
    choices.some(
      (choice) =>
        choice.index !== undefined &&
        (!Number.isSafeInteger(choice.index) || (choice.index as number) < 0),
    )
  ) {
    throw invalidMistralToolCall(undefined, usage);
  }
  const indexed = choices.filter((choice) => choice.index === 0);
  if (indexed.length === 1) return indexed[0];
  if (indexed.length > 1) throw invalidMistralToolCall(undefined, usage);
  if (choices.length === 0) return undefined;
  if (choices.length === 1 && (choices[0]?.index === undefined || choices[0]?.index === 0)) {
    return choices[0];
  }
  if (
    options.allowMissingPrimary === true &&
    choices.every((choice) => choice.index !== undefined)
  ) {
    return undefined;
  }
  throw invalidMistralToolCall(undefined, usage);
}

function finishReasonFromChoice(choice: Record<string, unknown> | undefined): string | undefined {
  return stringFrom(choice?.finishReason) ?? stringFrom(choice?.finish_reason);
}

function assertSafeToolCallFinish(
  toolCallCount: number,
  finishReason: CompletionFinishReason | undefined,
  usage?: Usage,
): void {
  if (toolCallCount === 0) return;
  if (finishReason === undefined) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }
  if (finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }
  if (finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }
  if (finishReason === "other") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason,
      usage,
    });
  }
}

function mistralToolCallIndex(value: unknown, usage?: Usage): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidMistralToolCall(undefined, usage);
  }
  return value as number;
}

function assertMistralFunctionToolCall(toolCall: Record<string, unknown>, usage?: Usage): void {
  if (toolCall.type !== undefined && toolCall.type !== "function") {
    throw invalidMistralToolCall(optionalMistralToolCallId(toolCall.id, usage), usage);
  }
}

function optionalMistralToolCallId(value: unknown, usage?: Usage): string | undefined {
  if (value === undefined || value === null || value === "null") return undefined;
  if (!isNonblankString(value)) throw invalidMistralToolCall(undefined, usage);
  return value;
}

function optionalMistralToolCallName(value: unknown, usage?: Usage): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!isNonblankString(value)) throw invalidMistralToolCall(undefined, usage);
  return value;
}

type MistralStreamToolArguments = Readonly<{
  text?: string | undefined;
  mode?: "replace" | undefined;
}>;

function mistralStreamToolArguments(
  value: unknown,
  toolCallId: string | undefined,
  usage?: Usage,
): MistralStreamToolArguments {
  if (value === undefined) return {};
  if (typeof value === "string") return { text: value };
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return { text: JSON.stringify(value), mode: "replace" };
}

function invalidMistralToolCall(
  toolCallId: string | undefined,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId,
    usage,
  });
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toolCallDelta(
  id: string,
  values: {
    callId?: string | undefined;
    name?: string | undefined;
    argumentsDelta?: string | undefined;
    argumentsMode?: "replace" | undefined;
  },
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  if (values.argumentsMode !== undefined) event.argumentsMode = values.argumentsMode;
  return event;
}

export const mistralMessageHelpers = {
  messageToMistralMessages,
  toolDefinitionToMistral,
};
