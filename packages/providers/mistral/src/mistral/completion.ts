import {
  AssistantContent,
  type AssistantContent as AssistantContentType,
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  type DocumentContent,
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
import type { Mistral } from "@mistralai/mistralai";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, parseJsonValue, schemaName, stringFrom } from "../utils";

type MistralChatParams = Record<string, unknown>;
type MistralChatMessage = Record<string, unknown>;

export class MistralCompletionModel implements StreamingCompletionModel {
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
    readonly defaultModel = "mistral-large-latest",
  ) {}

  traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    const params = toMistralChatParams(this.defaultModel, request);
    return providerRequestSummary(params, request, options);
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toMistralChatParams(this.defaultModel, request);
    const response = await this.client.chat.complete(params as never);
    return fromMistralChatResponse(response);
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = toMistralChatParams(this.defaultModel, request);
    const stream = await this.client.chat.stream(params as never);
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      for (const event of fromMistralChatStreamChunk(chunk)) {
        yield event;
      }
    }
  }
}

export function toMistralChatParams(
  defaultModel: string,
  request: CompletionRequest,
): MistralChatParams {
  const params: MistralChatParams = {
    model: request.model ?? defaultModel,
    messages: requestMessages(request).flatMap(messageToMistralMessages),
  };

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

  if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
    Object.assign(params, request.additionalParams);
  }

  return params;
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

function requestMessages(request: CompletionRequest): MessageType[] {
  return orderedRequestMessages(request, { includeInstructionsAsSystem: true });
}

export function fromMistralChatResponse(response: unknown): CompletionResponse {
  const raw = response as Record<string, unknown>;
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = choices.find(isPlainObject);
  const message = isPlainObject(firstChoice?.message) ? firstChoice.message : {};
  const choice: AssistantContentType[] = [];

  const text = stringContent(message.content);
  if (text !== undefined && text.length > 0) {
    choice.push(AssistantContent.text(text));
  }

  const toolCalls = toolCallsFrom(message);
  for (const toolCall of toolCalls) {
    const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
    const id = stringFrom(toolCall.id) ?? crypto.randomUUID();
    const name = stringFrom(fn.name) ?? "";
    const args = parseToolArguments(fn.arguments);
    choice.push(AssistantContent.toolCall(id, name, args));
  }

  const result: CompletionResponse = {
    choice,
    usage: usageFromMistral(raw.usage),
    rawResponse: response,
  };

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function fromMistralChatStreamChunk(chunk: unknown): CompletionStreamEvent[] {
  if (!isPlainObject(chunk)) {
    return [];
  }

  const events: CompletionStreamEvent[] = [];
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  for (const choice of choices) {
    if (!isPlainObject(choice) || !isPlainObject(choice.delta)) {
      continue;
    }

    const delta = choice.delta;
    const content = stringContent(delta.content);
    if (content !== undefined && content.length > 0) {
      events.push({ type: "text_delta", delta: content });
    }

    for (const toolCall of toolCallsFrom(delta)) {
      if (!isPlainObject(toolCall)) {
        continue;
      }
      const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
      const index = numberFrom(toolCall.index);
      events.push(
        toolCallDelta(`tool_${index}`, {
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
      usage: usageFromMistral(chunk.usage),
      rawResponse: chunk,
    };
    if (typeof chunk.id === "string") {
      response.messageId = chunk.id;
    }
    events.push({ type: "final", response });
  }

  return events;
}

function usageFromMistral(usage: unknown): Usage {
  const raw = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(raw.promptTokens) || numberFrom(raw.prompt_tokens);
  const outputTokens = numberFrom(raw.completionTokens) || numberFrom(raw.completion_tokens);
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens: numberFrom(raw.totalTokens) || numberFrom(raw.total_tokens),
  };
}

function messageToMistralMessages(message: MessageType): MistralChatMessage[] {
  if (message.role === "system") {
    return [{ role: "system", content: message.content }];
  }

  if (message.role === "user") {
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
    return message.content.map(toolContentToMistralMessage);
  }

  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  if (message.content.some((content) => content.type === "image")) {
    throw new Error("Mistral chat does not support image content in assistant history");
  }

  const toolCalls = message.content
    .filter((content) => content.type === "tool_call")
    .map((content) => ({
      id: content.id,
      type: "function",
      function: {
        name: content.function.name,
        arguments: JSON.stringify(content.function.arguments ?? {}),
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

function toolContentToMistralMessage(content: ToolContent): MistralChatMessage {
  return {
    role: "tool",
    toolCallId: content.callId ?? content.id,
    name: content.id,
    content: content.content
      .map((item) => (item.type === "text" ? item.text : item.data))
      .join("\n"),
  };
}

function userContentToMistralText(content: UserContent): string[] {
  if (content.type === "text") {
    return [content.text];
  }

  if (content.type === "image") {
    throw new Error("Mistral image inputs are not supported yet");
  }

  if (content.type === "document") {
    return documentToMistralText(content);
  }

  return [];
}

function documentToMistralText(document: DocumentContent): string[] {
  if (document.source.type === "text") {
    return [document.source.text];
  }

  throw new Error("Mistral document inputs are not supported yet");
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

function toolCallsFrom(message: Record<string, unknown>): Record<string, unknown>[] {
  const raw = message.toolCalls ?? message.tool_calls;
  return Array.isArray(raw) ? raw.filter(isPlainObject) : [];
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

function parseToolArguments(args: unknown): JsonValue {
  if (typeof args === "string") {
    return parseJsonValue(args);
  }
  return toJsonValue(args);
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
    return value.map(toJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
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
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const mistralMessageHelpers = {
  messageToMistralMessages,
  toolDefinitionToMistral,
};
