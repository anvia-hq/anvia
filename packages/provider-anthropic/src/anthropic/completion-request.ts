import {
  type CompletionRequest,
  type FilePart,
  getAssistantGenerationMetadata,
  type ImagePart,
  isJsonValue,
  type JsonObject,
  type Message as MessageType,
  type ModelCallOptions,
  type ReasoningDetail,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultContentPart,
  type ToolResultPart,
  type UserContentPart,
} from "@anvia/core/completion";
import {
  compactJsonObject,
  isPlainObject,
  numberFrom,
  orderedRequestMessages,
  stringFrom,
  toolChoiceSummary,
} from "@anvia/core/internal/provider";
import type { AnthropicCompletionModelId } from "./models";
import { type AnthropicPromptCacheOptions, withAnthropicPromptCache } from "./prompt-cache";

export type AnthropicCreateParams = Record<string, unknown>;
type AnthropicMessage = Record<string, unknown>;
type AnthropicContentBlock = Record<string, unknown>;

const DEFAULT_MAX_TOKENS = 1024;

export function anthropicRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  maxRetries: 0;
} {
  return { signal: options?.abortSignal, maxRetries: 0 };
}

export function toAnthropicMessagesParams(
  modelId: AnthropicCompletionModelId,
  request: CompletionRequest,
  promptCache?: AnthropicPromptCacheOptions | undefined,
): AnthropicCreateParams {
  const messages = orderedRequestMessages(request);
  const system = systemFromMessages(request, messages);

  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("Anthropic providerOptions must be a JSON object.");
  }

  const providerOptions = request.providerOptions ?? {};
  const params: AnthropicCreateParams = {
    ...providerOptions,
    model: modelId,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: anthropicHistory(messages),
  };

  const reasoningEffort = request.controls?.reasoningEffort;

  if (reasoningEffort !== undefined) {
    const outputConfig = isPlainObject(params.output_config) ? params.output_config : {};
    params.output_config = { ...outputConfig, effort: reasoningEffort };
  }

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

  return promptCache === undefined ? params : withAnthropicPromptCache(params, promptCache);
}

export function anthropicRequestSummary(
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
    hasSystem: hasSystemPrompt(params.system),
    temperature: request.temperature,
    maxTokens: request.maxTokens ?? numberFrom(params.max_tokens),
    toolChoice: toolChoiceSummary(request.toolChoice),
    providerOptionKeys: isPlainObject(request.providerOptions)
      ? Object.keys(request.providerOptions).sort()
      : undefined,
  });
}

function hasSystemPrompt(system: unknown): boolean {
  if (typeof system === "string") return system.length > 0;

  return Array.isArray(system) && system.length > 0;
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

/**
 * Maps the whole history in order. Tool-call ids are made unique across the request,
 * because another provider may reuse an id (Gemini numbers unnamed calls per response).
 */
function anthropicHistory(messages: MessageType[]): AnthropicMessage[] {
  const toolUseIds = new AnthropicToolUseIds();
  return messages.flatMap((message) => messageToAnthropicMessages(message, toolUseIds));
}

/**
 * Assigns Anthropic `tool_use` ids. The first call with an id keeps it. A later call
 * with the same id gets a numbered suffix. Each tool result uses the id of the latest
 * call it answers, which is the call that came just before it.
 */
class AnthropicToolUseIds {
  private readonly used = new Set<string>();
  private readonly latest = new Map<string, string>();

  forCall(baseId: string): string {
    let id = baseId;
    for (let suffix = 1; this.used.has(id); suffix += 1) {
      id = `${baseId}_${suffix.toString()}`;
    }
    this.used.add(id);
    this.latest.set(baseId, id);
    return id;
  }

  forResult(baseId: string): string {
    return this.latest.get(baseId) ?? baseId;
  }
}

function messageToAnthropicMessages(
  message: MessageType,
  toolUseIds: AnthropicToolUseIds = new AnthropicToolUseIds(),
): AnthropicMessage[] {
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

          return toolContentToAnthropicBlock(content, toolUseIds);
        }),
      },
    ];
  }

  const origin = getAssistantGenerationMetadata(message)?.provider;
  const replayReasoning = origin === undefined || origin === "anthropic";
  const content =
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
                id: toolUseIds.forCall(content.callId ?? content.toolCallId),
                name: content.toolName,
                input: content.input,
              },
            ];
          }

          if (content.type === "reasoning" && content.details !== undefined && replayReasoning) {
            return content.details.flatMap(reasoningContentToAnthropicBlocks);
          }

          if (content.type === "image" || content.type === "file") {
            throw new Error(
              "Anthropic Messages does not support image or file content in assistant history",
            );
          }

          return [];
        });

  if (Array.isArray(content) && content.length === 0) {
    return [];
  }

  return [{ role: "assistant", content }];
}

function toolContentToAnthropicBlock(
  content: ToolResultPart,
  toolUseIds: AnthropicToolUseIds,
): AnthropicContentBlock {
  const block: AnthropicContentBlock = {
    type: "tool_result",
    tool_use_id: toolUseIds.forResult(content.callId ?? content.toolCallId),
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
  if (content.type === "text" && content.signature !== undefined) {
    return [{ type: "thinking", thinking: content.text, signature: content.signature }];
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
