import {
  type CompletionRequest,
  type FilePart,
  type ImagePart,
  isJsonValue,
  type JsonObject,
  type Message as MessageType,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultPart,
  type UserContentPart,
} from "@anvia/core/completion";
import {
  compactJsonObject,
  isPlainObject,
  orderedRequestMessages,
  schemaName,
  stringFrom,
  toolChoiceSummary,
} from "@anvia/core/internal/provider";
import type { OpenAICompletionModelId } from "./models";

export type ChatCompletionParams = Record<string, unknown>;
export type ChatMessage = Record<string, unknown>;

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
    messages: orderedRequestMessages(request, { includeInstructionsAsSystem: true }).flatMap(
      messageToChatMessages,
    ),
  };

  if (request.controls?.reasoningEffort !== undefined) {
    params.reasoning_effort = request.controls.reasoningEffort;
  }

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

export function chatCompletionRequestSummary(
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

export const openAIChatCompletionMessageHelpers = {
  messageToChatMessages,
  toolDefinitionToOpenAIChatCompletion,
};
