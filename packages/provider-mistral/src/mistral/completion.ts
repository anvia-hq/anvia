import type { ModelContextLimits } from "@anvia/core/completion";
import {
  type AssistantContentPart,
  assertCompletionRequestSupported,
  type CompletionFinishReason,
  type CompletionModelCapabilities,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type FilePart,
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
import type { Mistral } from "@mistralai/mistralai";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, parseToolArguments, schemaName, stringFrom } from "../utils";
import type { MistralCompletionModelId } from "./models";

type MistralChatParams = Record<string, unknown>;
type MistralChatMessage = Record<string, unknown>;

export class MistralCompletionModel implements StreamingCompletionModel<unknown> {
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
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      providerFinishReason = mistralProviderFinishReason(chunk) ?? providerFinishReason;
      for (const event of fromMistralChatStreamChunk(chunk)) {
        if (event.type === "final") {
          applyMistralFinishReason(event.response, providerFinishReason);
        }
        yield event.type === "final"
          ? {
              ...event,
              response: withContextUsage(event.response, this.modelInfo()),
            }
          : event;
      }
    }
  }
}

export function toMistralChatParams(
  modelId: MistralCompletionModelId,
  request: CompletionRequest,
): MistralChatParams {
  const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
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
  const choice: AssistantContentPart[] = [];

  const text = stringContent(message.content);
  if (text !== undefined && text.length > 0) {
    choice.push({ type: "text", text });
  }

  const toolCalls = toolCallsFrom(message);
  for (const [index, toolCall] of toolCalls.entries()) {
    const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
    const id = stringFrom(toolCall.id) ?? deterministicToolCallId(raw.id, index);
    const name = stringFrom(fn.name) ?? "";
    const args = parseToolArgumentsValue(id, fn.arguments);
    choice.push({
      type: "tool-call",
      toolCallId: id,
      callId: id,
      toolName: name,
      input: args,
    });
  }

  const result: CompletionResponse = {
    choice,
    usage: usageFromMistral(raw.usage),
    rawResponse: response,
  };
  applyMistralFinishReason(result, mistralProviderFinishReason(response));

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function fromMistralChatStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  if (!isPlainObject(chunk)) {
    return [];
  }

  const events: CompletionModelStreamEvent[] = [];
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
    applyMistralFinishReason(response, mistralProviderFinishReason(chunk));
    events.push({ type: "final", response });
  }

  return events;
}

function mistralProviderFinishReason(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const choices = Array.isArray(value.choices) ? value.choices.filter(isPlainObject) : [];
  const choice = choices.find((candidate) => candidate.index === 0) ?? choices[0];
  return stringFrom(choice?.finishReason) ?? stringFrom(choice?.finish_reason);
}

function applyMistralFinishReason(response: CompletionResponse, value: string | undefined): void {
  if (value === undefined) return;
  response.finishReason = mistralFinishReason(value);
  response.providerFinishReason = value;
}

function mistralFinishReason(value: string): CompletionFinishReason {
  if (value === "stop") return "stop";
  if (value === "length" || value === "model_length") return "length";
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

function parseToolArgumentsValue(toolCallId: string, args: unknown): JsonValue {
  if (typeof args === "string") {
    return parseToolArguments(toolCallId, args);
  }
  return toJsonValue(args);
}

function deterministicToolCallId(responseId: unknown, index: number): string {
  const prefix = typeof responseId === "string" && responseId.length > 0 ? responseId : "mistral";
  return `${prefix}-tool-${index.toString()}`;
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
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const mistralMessageHelpers = {
  messageToMistralMessages,
  toolDefinitionToMistral,
};
