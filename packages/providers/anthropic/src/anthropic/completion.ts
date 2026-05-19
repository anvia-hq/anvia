import type { Anthropic } from "@anthropic-ai/sdk";
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
  type ReasoningContent,
  type StreamingCompletionModel,
  type ToolChoice,
  type ToolContent,
  type ToolDefinition,
  Usage,
  type UserContent,
} from "@anvia/core/completion";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, stringFrom } from "../utils";

type AnthropicCreateParams = Record<string, unknown>;
type AnthropicMessage = Record<string, unknown>;
type AnthropicContentBlock = Record<string, unknown>;

const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicCompletionModel implements StreamingCompletionModel {
  readonly provider = "anthropic";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: false,
    reasoning: true,
  };

  constructor(
    private readonly client: Anthropic,
    readonly defaultModel = "claude-sonnet-4-20250514",
  ) {}

  traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    const params = toAnthropicMessagesParams(this.defaultModel, request);
    if (options.stream === true) {
      params.stream = true;
    }
    return providerRequestSummary(params, request, options);
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toAnthropicMessagesParams(this.defaultModel, request);
    const response = await this.client.messages.create(params as never);
    return fromAnthropicMessage(response);
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = { ...toAnthropicMessagesParams(this.defaultModel, request), stream: true };
    const stream = await this.client.messages.create(params as never);
    const toolIdsByIndex = new Map<number, string>();
    const blocksWithInitialToolInput = new Set<number>();
    for await (const event of stream as unknown as AsyncIterable<unknown>) {
      if (isPlainObject(event) && event.type === "content_block_start") {
        const index = numberFrom(event.index);
        const block = isPlainObject(event.content_block) ? event.content_block : {};
        const id = stringFrom(block.id);
        if (id !== undefined) {
          toolIdsByIndex.set(index, id);
        }
        if (toolInputArgumentsDelta(block.input) !== undefined) {
          blocksWithInitialToolInput.add(index);
        }
      }
      for (const mapped of fromAnthropicStreamEvent(event)) {
        if (
          mapped.type === "tool_call_delta" &&
          mapped.argumentsDelta !== undefined &&
          isPlainObject(event) &&
          event.type === "content_block_delta" &&
          blocksWithInitialToolInput.has(numberFrom(event.index))
        ) {
          continue;
        }
        if (mapped.type === "tool_call_delta" && mapped.id.startsWith("tool_")) {
          const index = Number(mapped.id.slice("tool_".length));
          yield { ...mapped, id: toolIdsByIndex.get(index) ?? mapped.id };
        } else {
          yield mapped;
        }
      }
    }
  }
}

export function toAnthropicMessagesParams(
  defaultModel: string,
  request: CompletionRequest,
): AnthropicCreateParams {
  const messages = requestMessages(request);
  const system = systemFromMessages(request, messages);
  const params: AnthropicCreateParams = {
    model: request.model ?? defaultModel,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: messages.flatMap(messageToAnthropicMessages),
  };

  if (system !== undefined) {
    params.system = system;
  }

  if (request.tools.length > 0) {
    params.tools = request.tools.map(toolDefinitionToAnthropic);
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.toolChoice !== undefined) {
    params.tool_choice = toolChoiceToAnthropic(request.toolChoice);
  }

  if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
    Object.assign(params, request.additionalParams);
  }

  return params;
}

function providerRequestSummary(
  params: AnthropicCreateParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  return compactJsonObject({
    provider: "anthropic",
    api: "messages",
    stream: options.stream === true,
    model: stringFrom(params.model),
    parameterKeys: Object.keys(params).sort(),
    messageCount: Array.isArray(params.messages) ? params.messages.length : undefined,
    toolCount: request.tools.length,
    toolNames: request.tools.map((tool) => tool.name),
    hasSystem: typeof params.system === "string" && params.system.length > 0,
    temperature: request.temperature,
    maxTokens: request.maxTokens ?? numberFrom(params.max_tokens),
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
  return orderedRequestMessages(request);
}

function systemFromMessages(
  request: CompletionRequest,
  messages: MessageType[],
): string | undefined {
  const systemMessages = messages.flatMap((message) =>
    message.role === "system" ? [message.content] : [],
  );
  if (request.instructions !== undefined) {
    systemMessages.unshift(request.instructions);
  }
  return systemMessages.length === 0 ? undefined : systemMessages.join("\n\n");
}

export function fromAnthropicMessage(response: unknown): CompletionResponse {
  const raw = response as Record<string, unknown>;
  const content = Array.isArray(raw.content) ? raw.content : [];
  const choice: AssistantContentType[] = [];

  for (const block of content) {
    if (!isPlainObject(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      choice.push(AssistantContent.text(block.text));
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      const text: Extract<ReasoningContent, { type: "text" }> =
        typeof block.signature === "string"
          ? { type: "text", text: block.thinking, signature: block.signature }
          : { type: "text", text: block.thinking };
      choice.push(AssistantContent.reasoningFromContent([text]));
    }

    if (block.type === "redacted_thinking" && typeof block.data === "string") {
      choice.push(AssistantContent.reasoningRedacted(block.data));
    }

    if (block.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : crypto.randomUUID();
      const name = typeof block.name === "string" ? block.name : "";
      choice.push(AssistantContent.toolCall(id, name, toJsonValue(block.input)));
    }
  }

  const usageSource = isPlainObject(raw.usage) ? raw.usage : {};
  const result: CompletionResponse = {
    choice,
    usage: {
      ...Usage.empty(),
      inputTokens: numberFrom(usageSource.input_tokens),
      outputTokens: numberFrom(usageSource.output_tokens),
      totalTokens: numberFrom(usageSource.input_tokens) + numberFrom(usageSource.output_tokens),
      cachedInputTokens: numberFrom(usageSource.cache_read_input_tokens),
      cacheCreationInputTokens: numberFrom(usageSource.cache_creation_input_tokens),
    },
    rawResponse: response,
  };

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

export function fromAnthropicStreamEvent(event: unknown): CompletionStreamEvent[] {
  if (!isPlainObject(event) || typeof event.type !== "string") {
    return [];
  }

  if (event.type === "message_start" && isPlainObject(event.message)) {
    const id = stringFrom(event.message.id);
    return id === undefined ? [] : [{ type: "message_id", id }];
  }

  if (event.type === "content_block_start" && isPlainObject(event.content_block)) {
    const block = event.content_block;
    if (block.type === "tool_use") {
      return [
        toolCallDelta(stringFrom(block.id) ?? `tool_${numberFrom(event.index)}`, {
          name: stringFrom(block.name),
          argumentsDelta: toolInputArgumentsDelta(block.input),
        }),
      ];
    }
    if (block.type === "redacted_thinking" && typeof block.data === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: block.data,
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "redacted",
        },
      ];
    }
    return [];
  }

  if (event.type === "content_block_delta" && isPlainObject(event.delta)) {
    const delta = event.delta;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return [{ type: "text_delta", delta: delta.text }];
    }

    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: delta.thinking,
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "text",
        },
      ];
    }

    if (delta.type === "signature_delta" && typeof delta.signature === "string") {
      return [
        {
          type: "reasoning_delta",
          delta: "",
          id: `thinking_${numberFrom(event.index)}`,
          contentType: "text",
          signature: delta.signature,
        },
      ];
    }

    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      return [
        toolCallDelta(`tool_${numberFrom(event.index)}`, { argumentsDelta: delta.partial_json }),
      ];
    }
  }

  if (event.type === "message_stop" && isPlainObject(event.message)) {
    return [{ type: "final", response: fromAnthropicMessage(event.message) }];
  }

  if (event.type === "error") {
    return [{ type: "error", error: event.error ?? event }];
  }

  return [];
}

function messageToAnthropicMessages(message: MessageType): AnthropicMessage[] {
  if (message.role === "system") {
    return [];
  }

  if (message.role === "user") {
    return [
      {
        role: "user",
        content: message.content.map(userContentToAnthropicBlock),
      },
    ];
  }

  if (message.role === "tool") {
    return [
      {
        role: "user",
        content: message.content.map(toolContentToAnthropicBlock),
      },
    ];
  }

  return [
    {
      role: "assistant",
      content: message.content.flatMap((content): AnthropicContentBlock[] => {
        if (content.type === "text") {
          return [{ type: "text", text: content.text }];
        }

        if (content.type === "tool_call") {
          return [
            {
              type: "tool_use",
              id: content.callId ?? content.id,
              name: content.function.name,
              input: content.function.arguments ?? {},
            },
          ];
        }

        if (content.type === "reasoning" && content.content !== undefined) {
          return content.content.flatMap(reasoningContentToAnthropicBlocks);
        }

        if (content.type === "image") {
          throw new Error("Anthropic Messages does not support image content in assistant history");
        }

        return [];
      }),
    },
  ];
}

function toolContentToAnthropicBlock(content: ToolContent): AnthropicContentBlock {
  return {
    type: "tool_result",
    tool_use_id: content.callId ?? content.id,
    content: content.content
      .map((item) => (item.type === "text" ? item.text : item.data))
      .join("\n"),
  };
}

function reasoningContentToAnthropicBlocks(content: ReasoningContent): AnthropicContentBlock[] {
  if (content.type === "text" || content.type === "summary") {
    const block: AnthropicContentBlock = {
      type: "thinking",
      thinking: content.text,
    };
    if (content.type === "text" && content.signature !== undefined) {
      block.signature = content.signature;
    }
    return [block];
  }

  if (content.type === "redacted") {
    return [{ type: "redacted_thinking", data: content.data }];
  }

  return [];
}

function userContentToAnthropicBlock(content: UserContent): AnthropicContentBlock {
  if (content.type === "text") {
    return { type: "text", text: content.text };
  }

  if (content.type === "image") {
    return imageToAnthropicBlock(content);
  }

  if (content.type === "document") {
    return documentToAnthropicBlock(content);
  }

  throw new Error("Tool results must be mapped before user content blocks");
}

function imageToAnthropicBlock(image: ImageContent): AnthropicContentBlock {
  if (image.source.type === "url") {
    return {
      type: "image",
      source: {
        type: "url",
        url: image.source.url,
      },
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.source.mediaType,
      data: image.source.data,
    },
  };
}

function documentToAnthropicBlock(document: DocumentContent): AnthropicContentBlock {
  if (document.source.type === "text") {
    return { type: "text", text: document.source.text };
  }

  if (document.source.mediaType !== "application/pdf") {
    throw new Error("Anthropic Messages only supports PDF document attachments");
  }

  if (document.source.type === "url") {
    return {
      type: "document",
      source: {
        type: "url",
        url: document.source.url,
      },
    };
  }

  return {
    type: "document",
    source: {
      type: "base64",
      media_type: document.source.mediaType,
      data: document.source.data,
    },
  };
}

function toolDefinitionToAnthropic(tool: ToolDefinition): AnthropicContentBlock {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function toolChoiceToAnthropic(toolChoice: ToolChoice): unknown {
  if (toolChoice === "auto") {
    return { type: "auto" };
  }

  if (toolChoice === "required") {
    return { type: "any" };
  }

  if (toolChoice === "none") {
    return { type: "none" };
  }

  return {
    type: "tool",
    name: toolChoice.name,
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isPlainObject(value)
  ) {
    return value as JsonValue;
  }

  return String(value);
}

function toolInputArgumentsDelta(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed === "{}") {
      return undefined;
    }
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify(input);
    }
  }

  if (isPlainObject(input) && Object.keys(input).length === 0) {
    return undefined;
  }

  return JSON.stringify(toJsonValue(input));
}

function toolCallDelta(
  id: string,
  values: { name?: string | undefined; argumentsDelta?: string | undefined },
): CompletionStreamEvent {
  const event: CompletionStreamEvent = { type: "tool_call_delta", id };
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const anthropicMessageHelpers = {
  messageToAnthropicMessages,
  toolDefinitionToAnthropic,
};
