import {
  type CompletionRequest,
  getAssistantGenerationMetadata,
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
  toolChoiceSummary,
} from "@anvia/core/internal/provider";
import type { GeminiCompletionModelId } from "./models";
import { disableGeminiNativeRetries } from "./retry";

export type GeminiGenerateParams = Record<string, unknown>;
type GeminiConfig = Record<string, unknown>;
type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};
type GeminiPart = Record<string, unknown>;

export function toGeminiGenerateContentParams(
  modelId: GeminiCompletionModelId,
  request: CompletionRequest,
): GeminiGenerateParams {
  const messages = orderedRequestMessages(request);

  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("Gemini providerOptions must be a JSON object.");
  }

  const providerOptions = request.providerOptions ?? {};
  const { config: providerConfigValue, ...providerTopLevel } = providerOptions;

  if (providerConfigValue !== undefined && !isPlainObject(providerConfigValue)) {
    throw new TypeError("Gemini providerOptions.config must be a JSON object.");
  }

  const providerConfig = providerConfigValue === undefined ? {} : { ...providerConfigValue };
  delete providerConfig.tools;
  const configValues: GeminiConfig = {
    ...providerConfig,
    ...geminiConfig(request, messages),
  };
  const reasoningEffort = request.controls?.reasoningEffort;

  if (reasoningEffort !== undefined) {
    const thinkingConfig = isPlainObject(providerConfig.thinkingConfig)
      ? { ...providerConfig.thinkingConfig }
      : {};

    if (modelId.startsWith("gemini-2.5")) {
      delete thinkingConfig.thinkingLevel;
      configValues.thinkingConfig = {
        ...thinkingConfig,
        thinkingBudget: gemini25ThinkingBudget(reasoningEffort),
      };
    } else {
      delete thinkingConfig.thinkingBudget;
      configValues.thinkingConfig = { ...thinkingConfig, thinkingLevel: reasoningEffort };
    }
  }

  const config = disableGeminiNativeRetries(configValues);
  return {
    ...providerTopLevel,
    model: modelId,
    contents: messagesToGeminiContents(messages),
    config,
  };
}

export function applyAbortSignal(
  params: GeminiGenerateParams,
  options: ModelCallOptions | undefined,
): void {
  if (options?.abortSignal === undefined) return;

  const config = isPlainObject(params.config) ? params.config : {};
  params.config = { ...config, abortSignal: options.abortSignal };
}

export function geminiRequestSummary(
  params: GeminiGenerateParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  const config = isPlainObject(params.config) ? params.config : {};
  return compactJsonObject({
    provider: "gemini",
    api: options.stream === true ? "models.generateContentStream" : "models.generateContent",
    stream: options.stream === true,
    model: typeof params.model === "string" ? params.model : undefined,
    parameterKeys: Object.keys(params).sort(),
    contentCount: Array.isArray(params.contents) ? params.contents.length : undefined,
    configKeys: Object.keys(config).sort(),
    toolCount: request.tools.length,
    toolNames: request.tools.map((tool) => tool.name),
    hasSystemInstruction: config.systemInstruction !== undefined,
    hasOutputSchema: request.outputSchema !== undefined,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolChoice: toolChoiceSummary(request.toolChoice),
    providerOptionKeys: isPlainObject(request.providerOptions)
      ? Object.keys(request.providerOptions).sort()
      : undefined,
  });
}

export function messagesToGeminiContents(messages: MessageType[]): GeminiContent[] {
  const toolNamesById = new Map<string, string>();
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "assistant") {
      const content = assistantMessageToGeminiContent(message);
      for (const item of typeof message.content === "string" ? [] : message.content) {
        if (item.type === "tool-call") {
          toolNamesById.set(item.toolCallId, item.toolName);

          if (item.callId !== undefined) {
            toolNamesById.set(item.callId, item.toolName);
          }
        }
      }

      if (content.parts.length > 0) {
        contents.push(content);
      }

      continue;
    }

    const content =
      message.role === "tool"
        ? toolMessageToGeminiContent(message, toolNamesById)
        : userMessageToGeminiContent(message);

    if (content.parts.length > 0) {
      contents.push(content);
    }
  }

  return contents;
}

function gemini25ThinkingBudget(reasoningEffort: string): number {
  if (reasoningEffort === "low") return 1_024;

  if (reasoningEffort === "medium") return 8_192;

  if (reasoningEffort === "high") return 24_576;

  throw new TypeError(`Unsupported Gemini 2.5 reasoning effort: ${reasoningEffort}`);
}

function geminiConfig(request: CompletionRequest, messages: MessageType[]): GeminiConfig {
  const config: GeminiConfig = {};
  const systemInstruction = systemInstructionFrom(request, messages);

  if (systemInstruction !== undefined) {
    config.systemInstruction = systemInstruction;
  }

  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    config.maxOutputTokens = request.maxTokens;
  }

  if (request.tools.length > 0) {
    config.tools = [{ functionDeclarations: request.tools.map(toolDefinitionToGemini) }];
  }

  if (request.toolChoice !== undefined) {
    config.toolConfig = toolChoiceToGemini(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = request.outputSchema;
  }

  return config;
}

function systemInstructionFrom(
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

function userMessageToGeminiContent(
  message: Extract<MessageType, { role: "user" }>,
): GeminiContent {
  return {
    role: "user",
    parts:
      typeof message.content === "string"
        ? [{ text: message.content }]
        : message.content.map(userContentToGeminiPart),
  };
}

function toolMessageToGeminiContent(
  message: Extract<MessageType, { role: "tool" }>,
  toolNamesById: Map<string, string>,
): GeminiContent {
  return {
    role: "user",
    parts: message.content.map((content) => {
      if (content.type !== "tool-result") {
        throw new TypeError(
          "Anvia interaction responses must be resolved by Agent before provider calls.",
        );
      }

      return toolContentToGeminiPart(content, toolNamesById);
    }),
  };
}

function assistantMessageToGeminiContent(
  message: Extract<MessageType, { role: "assistant" }>,
): GeminiContent {
  const origin = getAssistantGenerationMetadata(message)?.provider;
  const replaySignatures = origin === undefined || origin === "gemini";
  return {
    role: "model",
    parts:
      typeof message.content === "string"
        ? [{ text: message.content }]
        : message.content.flatMap((content): GeminiPart[] => {
            if (content.type === "text") {
              const part: GeminiPart = { text: content.text };

              if (content.signature !== undefined) {
                part.thoughtSignature = content.signature;
              }

              return [part];
            }

            if (content.type === "tool-call") {
              const functionCall: Record<string, unknown> = {
                name: content.toolName,
                args: content.input,
              };

              if (content.callId !== undefined) {
                functionCall.id = content.callId;
              }

              const part: GeminiPart = { functionCall };

              if (content.signature !== undefined) {
                part.thoughtSignature = content.signature;
              }

              return [part];
            }

            if (content.type === "reasoning" && content.details !== undefined) {
              return content.details.flatMap((reasoning): GeminiPart[] => {
                if (reasoning.type !== "text" && reasoning.type !== "summary") {
                  return [];
                }

                const part: GeminiPart = { text: reasoning.text, thought: true };

                if (
                  replaySignatures &&
                  reasoning.type === "text" &&
                  reasoning.signature !== undefined
                ) {
                  part.thoughtSignature = reasoning.signature;
                }

                return [part];
              });
            }

            if (content.type === "image" || content.type === "file") {
              throw new Error(
                "Gemini does not support image or file content in assistant history yet",
              );
            }

            return [];
          }),
  };
}

function userContentToGeminiPart(content: UserContentPart): GeminiPart {
  if (content.type === "text") {
    return { text: content.text };
  }

  if (content.type === "image") {
    return imageContentToGeminiPart(content);
  }

  return documentContentToGeminiPart(content);
}

function imageContentToGeminiPart(
  content: Extract<UserContentPart, { type: "image" }>,
): GeminiPart {
  if (content.image.type === "data") {
    return {
      inlineData: {
        mimeType: content.mediaType ?? "image/png",
        data: content.image.data,
      },
    };
  }

  return {
    fileData: {
      fileUri: content.image.url,
      mimeType: content.mediaType ?? mimeTypeFromImageUrl(content.image.url),
    },
  };
}

function mimeTypeFromImageUrl(url: string): string {
  const pathname = safeUrlPathname(url).toLowerCase();

  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";

  if (pathname.endsWith(".webp")) return "image/webp";

  if (pathname.endsWith(".gif")) return "image/gif";

  if (pathname.endsWith(".bmp")) return "image/bmp";

  if (pathname.endsWith(".heic")) return "image/heic";

  if (pathname.endsWith(".heif")) return "image/heif";

  return "image/png";
}

function safeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function documentContentToGeminiPart(
  content: Extract<UserContentPart, { type: "file" }>,
): GeminiPart {
  if (content.data.type === "text") {
    return { text: content.data.text };
  }

  if (content.data.type === "data") {
    return {
      inlineData: {
        mimeType: content.mediaType,
        data: content.data.data,
      },
    };
  }

  return {
    fileData: {
      fileUri: content.data.url,
      mimeType: content.mediaType,
    },
  };
}

function toolContentToGeminiPart(
  content: ToolResultPart,
  toolNamesById: Map<string, string>,
): GeminiPart {
  const id = content.callId ?? content.toolCallId;
  const functionResponse: Record<string, unknown> = {
    name: content.toolName || toolNamesById.get(id) || content.toolCallId,
    response: toolResultResponse(content),
  };

  if (content.callId !== undefined) {
    functionResponse.id = content.callId;
  }

  return { functionResponse };
}

function toolResultResponse(content: ToolResultPart): Record<string, unknown> {
  const output = content.output;

  if (output.type === "json") {
    return { result: output.value };
  }

  if (output.type === "text") {
    return { content: output.value };
  }

  if (output.type === "error-json" || output.type === "error-text") {
    return { error: output.value };
  }

  if (output.type === "execution-denied") {
    return { error: output.reason ?? "Tool execution was denied." };
  }

  return {
    content: output.value
      .map((item) => (item.type === "text" ? item.text : `[file:${item.mediaType}]`))
      .join("\n"),
  };
}

function toolDefinitionToGemini(tool: ToolDefinition): GeminiPart {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  };
}

function toolChoiceToGemini(toolChoice: ToolChoice): GeminiPart {
  if (toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }

  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }

  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }

  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [toolChoice.name],
    },
  };
}
