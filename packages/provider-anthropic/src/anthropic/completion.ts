import type { Anthropic } from "@anthropic-ai/sdk";
import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
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
  type ImagePart,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type ReasoningDetail,
  type StreamingCompletionModel,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultContentPart,
  type ToolResultPart,
  Usage,
  type UserContentPart,
  withContextUsage,
} from "@anvia/core/completion";
import { orderedRequestMessages } from "../request-messages";
import { isPlainObject, numberFrom, stringFrom } from "../utils";
import type { AnthropicCompletionModelId } from "./models";

type AnthropicCreateParams = Record<string, unknown>;
type AnthropicMessage = Record<string, unknown>;
type AnthropicContentBlock = Record<string, unknown>;
type AnthropicMessageCreate = (
  params: AnthropicCreateParams,
  options: ReturnType<typeof anthropicRequestOptions>,
) => Promise<unknown>;

const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicCompletionModel implements StreamingCompletionModel<unknown> {
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
    private readonly client: Anthropic | AnthropicVertex,
    readonly modelId: AnthropicCompletionModelId,
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
    const params = toAnthropicMessagesParams(this.modelId, request);
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
    const params = toAnthropicMessagesParams(this.modelId, request);
    const response = await this.createMessage(params, anthropicRequestOptions(options));
    return withContextUsage(fromAnthropicMessage(response), this.modelInfo());
  }

  private createMessage(
    params: AnthropicCreateParams,
    options: ReturnType<typeof anthropicRequestOptions>,
  ): Promise<unknown> {
    const messages = this.client.messages;
    const create = messages.create as unknown as AnthropicMessageCreate;
    return create.call(messages, params, options);
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = { ...toAnthropicMessagesParams(this.modelId, request), stream: true };
    const stream = await this.createMessage(params, anthropicRequestOptions(options));
    const toolIdsByIndex = new Map<number, string>();
    const blocksWithInitialToolInput = new Set<number>();
    const streamUsage = Usage.empty();
    const streamUsageFields = emptyAnthropicStreamUsageFields();
    let hasStreamUsage = false;
    let streamMessageId: string | undefined;
    let streamProviderFinishReason: string | undefined;
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
      if (isPlainObject(event)) {
        if (event.type === "message_start" && isPlainObject(event.message)) {
          streamMessageId = stringFrom(event.message.id) ?? streamMessageId;
          streamProviderFinishReason =
            stringFrom(event.message.stop_reason) ?? streamProviderFinishReason;
        }
        if (event.type === "message_delta" && isPlainObject(event.delta)) {
          streamProviderFinishReason =
            stringFrom(event.delta.stop_reason) ?? streamProviderFinishReason;
        }
        hasStreamUsage =
          applyAnthropicStreamUsage(event, streamUsage, streamUsageFields) || hasStreamUsage;
      }
      for (const mapped of fromAnthropicStreamEvent(event)) {
        const usageMapped =
          mapped.type === "final" && hasStreamUsage
            ? {
                ...mapped,
                response: {
                  ...mapped.response,
                  usage: mergeUsage(mapped.response.usage, streamUsage, streamUsageFields),
                },
              }
            : mapped;
        if (usageMapped.type === "final") {
          applyAnthropicFinishReason(usageMapped.response, streamProviderFinishReason);
        }
        const streamMapped =
          usageMapped.type === "final"
            ? {
                ...usageMapped,
                response: withContextUsage(usageMapped.response, this.modelInfo()),
              }
            : usageMapped;
        if (
          streamMapped.type === "tool_call_delta" &&
          streamMapped.argumentsDelta !== undefined &&
          isPlainObject(event) &&
          event.type === "content_block_delta" &&
          blocksWithInitialToolInput.has(numberFrom(event.index))
        ) {
          continue;
        }
        if (streamMapped.type === "tool_call_delta" && streamMapped.id.startsWith("tool_")) {
          const index = Number(streamMapped.id.slice("tool_".length));
          yield { ...streamMapped, id: toolIdsByIndex.get(index) ?? streamMapped.id };
        } else {
          yield streamMapped;
        }
      }
      if (isPlainObject(event) && event.type === "message_stop" && !isPlainObject(event.message)) {
        const response: CompletionResponse = {
          choice: [],
          usage: copyUsage(streamUsage),
          rawResponse: event,
        };
        if (streamMessageId !== undefined) {
          response.messageId = streamMessageId;
        }
        applyAnthropicFinishReason(response, streamProviderFinishReason);
        yield {
          type: "final",
          response: withContextUsage(response, this.modelInfo()),
        };
      }
    }
  }
}

type AnthropicStreamUsageFields = {
  inputTokens: boolean;
  outputTokens: boolean;
  cachedInputTokens: boolean;
  cacheCreationInputTokens: boolean;
};

function emptyAnthropicStreamUsageFields(): AnthropicStreamUsageFields {
  return {
    inputTokens: false,
    outputTokens: false,
    cachedInputTokens: false,
    cacheCreationInputTokens: false,
  };
}

function applyAnthropicStreamUsage(
  event: Record<string, unknown>,
  usage: Usage,
  fields: AnthropicStreamUsageFields,
): boolean {
  let changed = false;
  let uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationInputTokens,
  );

  if (event.type === "message_start" && isPlainObject(event.message)) {
    const source = isPlainObject(event.message.usage) ? event.message.usage : undefined;
    if (source !== undefined) {
      if ("input_tokens" in source) {
        uncachedInputTokens = numberFrom(source.input_tokens);
        fields.inputTokens = true;
        changed = true;
      }
      if ("cache_read_input_tokens" in source) {
        usage.cachedInputTokens = numberFrom(source.cache_read_input_tokens);
        fields.cachedInputTokens = true;
        changed = true;
      }
      if ("cache_creation_input_tokens" in source) {
        usage.cacheCreationInputTokens = numberFrom(source.cache_creation_input_tokens);
        fields.cacheCreationInputTokens = true;
        changed = true;
      }
    }
  }

  if (event.type === "message_delta") {
    const source = isPlainObject(event.usage) ? event.usage : undefined;
    if (source !== undefined && "output_tokens" in source) {
      usage.outputTokens = Math.max(usage.outputTokens, numberFrom(source.output_tokens));
      fields.outputTokens = true;
      changed = true;
    }
  }

  if (changed) {
    Object.assign(
      usage,
      anthropicUsage(
        uncachedInputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
        usage.cacheCreationInputTokens,
      ),
    );
  }

  return changed;
}

function mergeUsage(base: Usage, stream: Usage, fields: AnthropicStreamUsageFields): Usage {
  const baseUncachedInputTokens = Math.max(
    0,
    base.inputTokens - base.cachedInputTokens - base.cacheCreationInputTokens,
  );
  const streamUncachedInputTokens = Math.max(
    0,
    stream.inputTokens - stream.cachedInputTokens - stream.cacheCreationInputTokens,
  );
  const uncachedInputTokens = fields.inputTokens
    ? streamUncachedInputTokens
    : baseUncachedInputTokens;
  const outputTokens = fields.outputTokens ? stream.outputTokens : base.outputTokens;
  const cachedInputTokens = fields.cachedInputTokens
    ? stream.cachedInputTokens
    : base.cachedInputTokens;
  const cacheCreationInputTokens = fields.cacheCreationInputTokens
    ? stream.cacheCreationInputTokens
    : base.cacheCreationInputTokens;
  return anthropicUsage(
    uncachedInputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
  );
}

function copyUsage(usage: Usage): Usage {
  let copy: Usage = { ...usage };
  if (usage.details !== undefined) copy = { ...copy, details: { ...usage.details } };
  return copy;
}

export function toAnthropicMessagesParams(
  modelId: AnthropicCompletionModelId,
  request: CompletionRequest,
): AnthropicCreateParams {
  const messages = requestMessages(request);
  const system = systemFromMessages(request, messages);
  const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
  const params: AnthropicCreateParams = {
    ...providerOptions,
    model: modelId,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: messages.flatMap(messageToAnthropicMessages),
  };

  delete params.tools;

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

  return params;
}

function anthropicRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  maxRetries: 0;
} {
  return { signal: options?.abortSignal, maxRetries: 0 };
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
  const choice: AssistantContentPart[] = [];

  for (const block of content) {
    if (!isPlainObject(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      choice.push({ type: "text", text: block.text });
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      const text: Extract<ReasoningDetail, { type: "text" }> =
        typeof block.signature === "string"
          ? { type: "text", text: block.thinking, signature: block.signature }
          : { type: "text", text: block.thinking };
      choice.push({ type: "reasoning", text: block.thinking, details: [text] });
    }

    if (block.type === "redacted_thinking" && typeof block.data === "string") {
      choice.push({
        type: "reasoning",
        text: "",
        details: [{ type: "redacted", data: block.data }],
      });
    }

    if (block.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : crypto.randomUUID();
      const name = typeof block.name === "string" ? block.name : "";
      choice.push({
        type: "tool-call",
        toolCallId: id,
        callId: id,
        toolName: name,
        input: toJsonValue(block.input),
      });
    }
  }

  const usageSource = isPlainObject(raw.usage) ? raw.usage : {};
  const usage = anthropicUsage(
    numberFrom(usageSource.input_tokens),
    numberFrom(usageSource.output_tokens),
    numberFrom(usageSource.cache_read_input_tokens),
    numberFrom(usageSource.cache_creation_input_tokens),
  );
  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyAnthropicFinishReason(result, raw.stop_reason);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  return result;
}

function applyAnthropicFinishReason(response: CompletionResponse, value: unknown): void {
  if (typeof value !== "string") return;
  response.finishReason = anthropicFinishReason(value);
  response.providerFinishReason = value;
}

function anthropicFinishReason(value: string): CompletionFinishReason {
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "max_tokens" || value === "model_context_window_exceeded") return "length";
  if (value === "tool_use") return "tool-calls";
  if (value === "refusal") return "content-filter";
  return "other";
}

function anthropicUsage(
  uncachedInputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): Usage {
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheCreationInputTokens;
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    details: {
      input: uncachedInputTokens,
      cache_read_input_tokens: cachedInputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      output: outputTokens,
      total: totalTokens,
    },
  };
}

export function fromAnthropicStreamEvent(event: unknown): CompletionModelStreamEvent[] {
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
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
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
        content: message.content.map((content) => {
          if (content.type !== "tool-result") {
            throw new TypeError(
              "Anvia interaction responses must be resolved by Agent before provider calls.",
            );
          }
          return toolContentToAnthropicBlock(content);
        }),
      },
    ];
  }

  return [
    {
      role: "assistant",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.flatMap((content): AnthropicContentBlock[] => {
              if (content.type === "text") {
                return [{ type: "text", text: content.text }];
              }

              if (content.type === "tool-call") {
                return [
                  {
                    type: "tool_use",
                    id: content.callId ?? content.toolCallId,
                    name: content.toolName,
                    input: content.input,
                  },
                ];
              }

              if (content.type === "reasoning" && content.details !== undefined) {
                return content.details.flatMap(reasoningContentToAnthropicBlocks);
              }

              if (content.type === "image" || content.type === "file") {
                throw new Error(
                  "Anthropic Messages does not support image or file content in assistant history",
                );
              }

              return [];
            }),
    },
  ];
}

function toolContentToAnthropicBlock(content: ToolResultPart): AnthropicContentBlock {
  const block: AnthropicContentBlock = {
    type: "tool_result",
    tool_use_id: content.callId ?? content.toolCallId,
    content: toolResultToAnthropicContent(content),
  };
  if (
    content.output.type === "error-text" ||
    content.output.type === "error-json" ||
    content.output.type === "execution-denied"
  ) {
    block.is_error = true;
  }
  return block;
}

function toolResultContentToAnthropicContent(
  content: readonly ToolResultContentPart[],
): string | AnthropicContentBlock[] {
  if (content.every((item) => item.type === "text")) {
    return content.map((item) => item.text).join("\n");
  }

  return content.map((item) => {
    if (item.type === "text") {
      return { type: "text", text: item.text };
    }
    return fileToAnthropicBlock(item);
  });
}

function toolResultToAnthropicContent(content: ToolResultPart): string | AnthropicContentBlock[] {
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
  return toolResultContentToAnthropicContent(output.value);
}

function reasoningContentToAnthropicBlocks(content: ReasoningDetail): AnthropicContentBlock[] {
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

function userContentToAnthropicBlock(content: UserContentPart): AnthropicContentBlock {
  if (content.type === "text") {
    return { type: "text", text: content.text };
  }

  if (content.type === "image") {
    return imageToAnthropicBlock(content);
  }

  if (content.type === "file") {
    return fileToAnthropicBlock(content);
  }

  throw new Error("Tool results must be mapped before user content blocks");
}

function imageToAnthropicBlock(image: ImagePart): AnthropicContentBlock {
  if (image.image.type === "url") {
    return {
      type: "image",
      source: {
        type: "url",
        url: image.image.url,
      },
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType ?? "image/png",
      data: image.image.data,
    },
  };
}

function fileToAnthropicBlock(file: FilePart): AnthropicContentBlock {
  if (file.data.type === "text") {
    return { type: "text", text: file.data.text };
  }

  if (file.mediaType.startsWith("image/")) {
    return imageToAnthropicBlock({
      type: "image",
      image: file.data,
      mediaType: file.mediaType,
    });
  }

  if (file.mediaType !== "application/pdf") {
    throw new Error("Anthropic Messages only supports image and PDF file attachments");
  }

  if (file.data.type === "url") {
    return {
      type: "document",
      source: {
        type: "url",
        url: file.data.url,
      },
    };
  }

  return {
    type: "document",
    source: {
      type: "base64",
      media_type: file.mediaType,
      data: file.data.data,
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
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  return event;
}

export const anthropicMessageHelpers = {
  messageToAnthropicMessages,
  toolDefinitionToAnthropic,
};
