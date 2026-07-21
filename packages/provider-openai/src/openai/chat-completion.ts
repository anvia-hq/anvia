import {
  AssistantContent,
  type AssistantContent as AssistantContentType,
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  type DocumentContent,
  type ImageContent,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type StreamingCompletionModel,
  type ToolChoice,
  type ToolContent,
  type ToolDefinition,
  Usage,
  type UserContent,
} from "@anvia/core/completion";
import type { OpenAI } from "openai";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, parseToolArguments, schemaName, stringFrom } from "../utils";
import type { OpenAICompletionModelName } from "./models";

type ChatCompletionParams = Record<string, unknown>;
type ChatMessage = Record<string, unknown>;

type ChatCompletionStreamChunkMapping = {
  events: CompletionStreamEvent[];
  hasToolCalls: boolean;
  hasFinishReason: boolean;
  finishReason?: unknown;
};

const INVALID_TOOL_INDEX_ERROR =
  "OpenAI Chat Completions stream returned a tool call with an invalid index; expected a finite nonnegative integer.";
const AMBIGUOUS_CHOICE_ERROR =
  "OpenAI Chat Completions stream returned ambiguous completion choices without valid indices; provider output cannot be assembled safely.";
const MISSING_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream ended without a terminal finish reason; provider output may be incomplete.";
const LENGTH_TOOL_FINISH_ERROR =
  'OpenAI Chat Completions tool-call stream ended with finish_reason "length"; provider output may be incomplete.';
const CONTENT_FILTER_TOOL_FINISH_ERROR =
  'OpenAI Chat Completions tool-call stream ended with finish_reason "content_filter"; tool calls will not be executed.';
const UNSUPPORTED_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream ended with an unsupported finish reason; provider output cannot be assembled safely.";
const CONFLICTING_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream returned conflicting terminal finish reasons; provider output cannot be assembled safely.";

export class OpenAIChatCompletionModel
  implements StreamingCompletionModel<unknown, OpenAICompletionModelName>
{
  readonly provider = "openai-chat";
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
    readonly defaultModel: OpenAICompletionModelName = "openai/gpt-5.2",
  ) {}

  traceRequest(
    request: CompletionRequest<OpenAICompletionModelName>,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    const params: ChatCompletionParams = toOpenAIChatCompletionParams(this.defaultModel, request);
    if (options.stream === true) {
      params.stream = true;
      const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
      params.stream_options = { ...streamOptions, include_usage: true };
    }
    return providerRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest<OpenAICompletionModelName>,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toOpenAIChatCompletionParams(this.defaultModel, request);
    const response = await this.client.chat.completions.create(params as never);
    return fromOpenAIChatCompletionResponse(response);
  }

  async *streamCompletion(
    request: CompletionRequest<OpenAICompletionModelName>,
  ): AsyncIterable<CompletionStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params: ChatCompletionParams = {
      ...toOpenAIChatCompletionParams(this.defaultModel, request),
      stream: true,
    };
    const streamOptions = isPlainObject(params.stream_options) ? params.stream_options : {};
    params.stream_options = { ...streamOptions, include_usage: true };
    const stream = await this.client.chat.completions.create(params as never);
    const streamState = new OpenAIChatCompletionStreamState();
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      const mapping = streamState.mapChunk(chunk);
      for (const event of mapping.events) {
        yield event;
      }
    }
    streamState.assertComplete();
  }
}

export function toOpenAIChatCompletionParams(
  defaultModel: OpenAICompletionModelName,
  request: CompletionRequest<OpenAICompletionModelName>,
): ChatCompletionParams {
  const params: ChatCompletionParams = {
    model: request.model ?? defaultModel,
    messages: requestMessages(request).flatMap(messageToChatMessages),
  };

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

  if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
    Object.assign(params, request.additionalParams);
  }

  return params;
}

function providerRequestSummary(
  params: ChatCompletionParams,
  request: CompletionRequest<OpenAICompletionModelName>,
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
    additionalParamKeys: isPlainObject(request.additionalParams)
      ? Object.keys(request.additionalParams).sort()
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
      if (value === undefined) {
        return [];
      }
      return [[key, toJsonValue(value)]];
    }),
  ) as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (isPlainObject(value)) {
    return compactJsonObject(value);
  }
  return String(value);
}

function requestMessages(request: CompletionRequest<OpenAICompletionModelName>): MessageType[] {
  return orderedRequestMessages(request, { includeInstructionsAsSystem: true });
}

export function fromOpenAIChatCompletionResponse(response: unknown): CompletionResponse {
  const raw = response as Record<string, unknown>;
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice =
    choices.find((choice) => isPlainObject(choice) && choice.index === 0) ??
    choices.find(isPlainObject);
  const message = isPlainObject(firstChoice?.message) ? firstChoice.message : {};
  const choice: AssistantContentType[] = [];

  const reasoning = stringFrom(message.reasoning) ?? stringFrom(message.reasoning_content);
  if (reasoning !== undefined && reasoning.length > 0) {
    choice.push(AssistantContent.reasoning(reasoning));
  }

  if (typeof message.content === "string" && message.content.length > 0) {
    choice.push(AssistantContent.text(message.content));
  }

  if (typeof message.refusal === "string" && message.refusal.length > 0) {
    choice.push(AssistantContent.text(message.refusal));
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    if (!isPlainObject(toolCall)) {
      continue;
    }

    const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
    const id = typeof toolCall.id === "string" ? toolCall.id : crypto.randomUUID();
    const name = typeof fn.name === "string" ? fn.name : "";
    const argsText = typeof fn.arguments === "string" ? fn.arguments : "{}";
    choice.push(AssistantContent.toolCall(id, name, parseToolArguments(id, argsText)));
  }

  const result: CompletionResponse = {
    choice,
    usage: usageFromOpenAIChatCompletion(raw.usage),
    rawResponse: response,
  };

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function fromOpenAIChatCompletionStreamChunk(chunk: unknown): CompletionStreamEvent[] {
  return mapOpenAIChatCompletionStreamChunk(chunk).events;
}

function mapOpenAIChatCompletionStreamChunk(
  chunk: unknown,
  reasoningId?: string,
): ChatCompletionStreamChunkMapping {
  if (!isPlainObject(chunk)) {
    return { events: [], hasToolCalls: false, hasFinishReason: false };
  }

  const events: CompletionStreamEvent[] = [];
  const choice = primaryStreamChoice(chunk.choices);
  let hasToolCalls = false;

  if (choice !== undefined && isPlainObject(choice.delta)) {
    const delta = choice.delta;
    const reasoning = stringFrom(delta.reasoning) ?? stringFrom(delta.reasoning_content);
    if (reasoning !== undefined && reasoning.length > 0) {
      const event: CompletionStreamEvent = { type: "reasoning_delta", delta: reasoning };
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
        continue;
      }
      hasToolCalls = true;
      const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
      const index = toolCallIndex(toolCall.index);
      const id = `tool_${index}`;
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
  };
  if (mapping.hasFinishReason) {
    mapping.finishReason = choice?.finish_reason;
  }
  return mapping;
}

class OpenAIChatCompletionStreamState {
  private readonly reasoningId = crypto.randomUUID();
  private hasToolCalls = false;
  private hasFinishReason = false;
  private finishReason: unknown;

  mapChunk(chunk: unknown): ChatCompletionStreamChunkMapping {
    const mapping = mapOpenAIChatCompletionStreamChunk(chunk, this.reasoningId);
    this.accept(mapping);
    return mapping;
  }

  private accept(mapping: ChatCompletionStreamChunkMapping): void {
    this.hasToolCalls ||= mapping.hasToolCalls;
    if (!mapping.hasFinishReason) {
      return;
    }
    if (this.hasFinishReason && mapping.finishReason !== this.finishReason) {
      throw new Error(CONFLICTING_TOOL_FINISH_ERROR);
    }
    this.hasFinishReason = true;
    this.finishReason = mapping.finishReason;
    if (this.hasToolCalls) {
      this.assertSupportedFinishReason();
    }
  }

  assertComplete(): void {
    if (!this.hasToolCalls) {
      return;
    }
    if (!this.hasFinishReason) {
      throw new Error(MISSING_TOOL_FINISH_ERROR);
    }
    this.assertSupportedFinishReason();
  }

  private assertSupportedFinishReason(): void {
    if (this.finishReason === "length") {
      throw new Error(LENGTH_TOOL_FINISH_ERROR);
    }
    if (this.finishReason === "content_filter") {
      throw new Error(CONTENT_FILTER_TOOL_FINISH_ERROR);
    }
    if (
      this.finishReason !== "tool_calls" &&
      this.finishReason !== "stop" &&
      this.finishReason !== "function_call"
    ) {
      throw new Error(UNSUPPORTED_TOOL_FINISH_ERROR);
    }
  }
}

function primaryStreamChoice(value: unknown): Record<string, unknown> | undefined {
  const choices = Array.isArray(value) ? value.filter(isPlainObject) : [];
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
      throw new Error(AMBIGUOUS_CHOICE_ERROR);
    }
    indexedChoices.push({ choice, index: choice.index });
  }

  if (unindexedChoices.length > 0) {
    if (indexedChoices.length > 0 || unindexedChoices.length > 1) {
      throw new Error(AMBIGUOUS_CHOICE_ERROR);
    }
    return unindexedChoices[0];
  }

  const primaryChoices = indexedChoices.filter(({ index }) => index === 0);
  if (primaryChoices.length > 1) {
    throw new Error(AMBIGUOUS_CHOICE_ERROR);
  }
  return primaryChoices[0]?.choice;
}

function toolCallIndex(value: unknown): number {
  if (!isStreamIndex(value)) {
    throw new Error(INVALID_TOOL_INDEX_ERROR);
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

function usageFromOpenAIChatCompletion(usage: unknown): Usage {
  const usageSource = isPlainObject(usage) ? usage : {};
  const promptDetails = isPlainObject(usageSource.prompt_tokens_details)
    ? usageSource.prompt_tokens_details
    : {};

  return {
    ...Usage.empty(),
    inputTokens: numberFrom(usageSource.prompt_tokens),
    outputTokens: numberFrom(usageSource.completion_tokens),
    totalTokens: numberFrom(usageSource.total_tokens),
    cachedInputTokens: numberFrom(promptDetails.cached_tokens),
  };
}

function messageToChatMessages(message: MessageType): ChatMessage[] {
  if (message.role === "system") {
    return [{ role: "system", content: message.content }];
  }

  if (message.role === "user") {
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
    return message.content.map(toolContentToChatMessage);
  }

  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  const reasoning = message.content
    .flatMap((content) => (content.type === "reasoning" ? [content.text] : []))
    .filter((text) => text.length > 0)
    .join("\n");
  if (message.content.some((content) => content.type === "image")) {
    throw new Error("OpenAI chat completions does not support image content in assistant history");
  }
  const toolCalls = message.content
    .filter((content) => content.type === "tool_call")
    .map((content) => ({
      id: content.callId ?? content.id,
      type: "function",
      function: {
        name: content.function.name,
        arguments: JSON.stringify(content.function.arguments ?? {}),
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

function toolContentToChatMessage(content: ToolContent): ChatMessage {
  return {
    role: "tool",
    tool_call_id: content.callId ?? content.id,
    content: content.content
      .map((item) =>
        item.type === "text" ? item.text : `[image:${item.mediaType ?? "image/png"}]`,
      )
      .join("\n"),
  };
}

function userContentToChatParts(content: UserContent): ChatMessage[] {
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

  if (content.type === "document") {
    return documentToChatParts(content);
  }

  return [];
}

function imageUrl(image: ImageContent): string {
  if (image.source.type === "url") {
    return image.source.url;
  }

  return `data:${image.source.mediaType};base64,${image.source.data}`;
}

function documentToChatParts(document: DocumentContent): ChatMessage[] {
  if (document.source.type === "text") {
    return [{ type: "text", text: document.source.text }];
  }

  throw new Error("OpenAI chat completions does not support file document attachments");
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
): CompletionStreamEvent {
  const event: CompletionStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined && values.callId.length > 0) event.callId = values.callId;
  if (values.name !== undefined && values.name.length > 0) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const openAIChatCompletionMessageHelpers = {
  messageToChatMessages,
  toolDefinitionToOpenAIChatCompletion,
};
