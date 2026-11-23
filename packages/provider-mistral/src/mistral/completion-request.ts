import {
  type CompletionRequest,
  type FilePart,
  isJsonValue,
  type JsonObject,
  type Message as MessageType,
  type ModelCallOptions,
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
import type { MistralCompletionModelId } from "./models";

export type MistralChatParams = Record<string, unknown>;
type MistralChatMessage = Record<string, unknown>;

export function mistralRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  retries: { strategy: "none" };
} {
  return { signal: options?.abortSignal, retries: { strategy: "none" } };
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
    messages: orderedRequestMessages(request, { includeInstructionsAsSystem: true }).flatMap(
      messageToMistralMessages,
    ),
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

export function mistralRequestSummary(
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

export const mistralMessageHelpers = {
  messageToMistralMessages,
  toolDefinitionToMistral,
};
