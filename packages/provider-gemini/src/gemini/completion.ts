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
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type StreamingCompletionModel,
  type ToolCallArgumentsMode,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultPart,
  Usage,
  type UserContentPart,
  withContextUsage,
} from "@anvia/core/completion";
import type { GoogleGenAI } from "@google/genai";
import { orderedRequestMessages } from "../request-messages";
import type { GeminiCompletionModelId } from "./models";
import { disableGeminiNativeRetries } from "./retry";

type GeminiGenerateParams = Record<string, unknown>;
type GeminiConfig = Record<string, unknown>;
type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};
type GeminiPart = Record<string, unknown>;

export class GeminiCompletionModel implements StreamingCompletionModel<unknown> {
  readonly provider = "gemini";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };

  constructor(
    private readonly client: GoogleGenAI,
    readonly modelId: GeminiCompletionModelId,
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
    const params = toGeminiGenerateContentParams(this.modelId, request);
    return providerRequestSummary(params, request, options);
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this, request);
    const params = toGeminiGenerateContentParams(this.modelId, request);
    applyAbortSignal(params, options);
    const response = await this.client.models.generateContent(params as never);
    return withContextUsage(fromGeminiGenerateContentResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = toGeminiGenerateContentParams(this.modelId, request);
    applyAbortSignal(params, options);
    const stream = await this.client.models.generateContentStream(params as never);
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      for (const event of fromGeminiGenerateContentStreamChunk(chunk)) {
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

export function toGeminiGenerateContentParams(
  modelId: GeminiCompletionModelId,
  request: CompletionRequest,
): GeminiGenerateParams {
  const messages = requestMessages(request);
  const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
  const { config: providerConfigValue, ...providerTopLevel } = providerOptions;
  const providerConfig = isPlainObject(providerConfigValue) ? { ...providerConfigValue } : {};
  delete providerConfig.tools;
  const config = disableGeminiNativeRetries({
    ...providerConfig,
    ...geminiConfig(request, messages),
  });
  const params: GeminiGenerateParams = {
    ...providerTopLevel,
    model: modelId,
    contents: messagesToGeminiContents(messages),
    config,
  };

  return params;
}

function applyAbortSignal(
  params: GeminiGenerateParams,
  options: ModelCallOptions | undefined,
): void {
  if (options?.abortSignal === undefined) return;
  const config = isPlainObject(params.config) ? params.config : {};
  params.config = { ...config, abortSignal: options.abortSignal };
}

function providerRequestSummary(
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
                if (reasoning.type === "text" && reasoning.signature !== undefined) {
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

export function fromGeminiGenerateContentResponse(response: unknown): CompletionResponse {
  const raw = response as Record<string, unknown>;
  const choice = assistantContentFromGeminiResponse(raw);

  const result: CompletionResponse = {
    choice,
    usage: usageFromGemini(raw.usageMetadata),
    rawResponse: response,
  };
  applyGeminiFinishReason(result, raw);
  const id = stringFrom(raw.responseId) ?? stringFrom(raw.id);
  if (id !== undefined) {
    result.messageId = id;
  }
  return result;
}

function applyGeminiFinishReason(response: CompletionResponse, raw: Record<string, unknown>): void {
  const value = stringFrom(primaryGeminiCandidate(raw)?.finishReason);
  if (value === undefined) return;
  response.finishReason = geminiFinishReason(value, response.choice);
  response.providerFinishReason = value;
}

function geminiFinishReason(
  value: string,
  choice: readonly AssistantContentPart[],
): CompletionFinishReason {
  if (value === "MAX_TOKENS") return "length";
  if (
    value === "SAFETY" ||
    value === "RECITATION" ||
    value === "BLOCKLIST" ||
    value === "PROHIBITED_CONTENT" ||
    value === "SPII" ||
    value === "IMAGE_SAFETY" ||
    value === "IMAGE_PROHIBITED_CONTENT"
  ) {
    return "content-filter";
  }
  if (value === "STOP") {
    return choice.some((part) => part.type === "tool-call") ? "tool-calls" : "stop";
  }
  return "other";
}

export function fromGeminiGenerateContentStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  if (!isPlainObject(chunk)) {
    return [];
  }

  const events: CompletionModelStreamEvent[] = [];
  const directText = typeof chunk.text === "string" ? chunk.text : "";
  if (directText.length > 0 && candidateParts(chunk).length === 0) {
    events.push({ type: "text_delta", delta: directText });
  }
  for (const part of candidateParts(chunk)) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        events.push({ type: "reasoning_delta", delta: part.text, contentType: "summary" });
      } else {
        events.push({ type: "text_delta", delta: part.text });
      }
    }
  }
  for (const call of functionCallsFromGeminiResponse(chunk)) {
    events.push(
      toolCallDelta(call.id ?? call.name, {
        callId: call.id,
        name: call.name,
        signature: call.signature,
      }),
    );
    events.push(
      toolCallDelta(call.id ?? call.name, {
        callId: call.id,
        argumentsDelta: JSON.stringify(call.args ?? {}),
        argumentsMode: "replace",
      }),
    );
  }
  const id = stringFrom(chunk.responseId) ?? stringFrom(chunk.id);
  if (id !== undefined) {
    events.push({ type: "message_id", id });
  }
  if (isPlainObject(chunk.usageMetadata)) {
    events.push({ type: "final", response: fromGeminiGenerateContentResponse(chunk) });
  }
  return events;
}

function assistantContentFromGeminiResponse(
  response: Record<string, unknown>,
): AssistantContentPart[] {
  const parts = candidateParts(response);
  if (parts.length === 0) {
    const text = textFromGeminiResponse(response);
    return text.length > 0 ? [{ type: "text", text }] : [];
  }

  const choice: AssistantContentPart[] = [];
  for (const part of parts) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        choice.push({
          type: "reasoning",
          text: part.text,
          details: [{ type: "summary", text: part.text }],
        });
      } else {
        const signature = thoughtSignatureFrom(part);
        let text: Extract<AssistantContentPart, { type: "text" }> = {
          type: "text",
          text: part.text,
        };
        if (signature !== undefined) text = { ...text, signature };
        choice.push(text);
      }
    }
    if (isPlainObject(part.functionCall)) {
      const call = functionCallFromGeminiPart(part.functionCall, part);
      if (call !== undefined) {
        const toolCallId = call.id ?? crypto.randomUUID();
        let toolCall: Extract<AssistantContentPart, { type: "tool-call" }> = {
          type: "tool-call",
          toolCallId,
          toolName: call.name,
          input: call.args,
        };
        if (call.id !== undefined) toolCall = { ...toolCall, callId: call.id };
        if (call.signature !== undefined) toolCall = { ...toolCall, signature: call.signature };
        choice.push(toolCall);
      }
    }
  }
  return choice;
}

function textFromGeminiResponse(response: Record<string, unknown>): string {
  if (typeof response.text === "string") {
    return response.text;
  }
  return candidateParts(response)
    .flatMap((part) => (part.thought !== true && typeof part.text === "string" ? [part.text] : []))
    .join("");
}

function functionCallsFromGeminiResponse(
  response: Record<string, unknown>,
): Array<{ id?: string | undefined; name: string; args: JsonValue; signature?: string }> {
  const directCalls = Array.isArray(response.functionCalls)
    ? response.functionCalls
    : Array.isArray(response.function_calls)
      ? response.function_calls
      : [];
  const partCalls = candidateParts(response).flatMap((part) => {
    if (!isPlainObject(part.functionCall)) {
      return [];
    }
    const call = functionCallFromGeminiPart(part.functionCall, part);
    return call === undefined ? [] : [call];
  });

  const normalizedDirectCalls = directCalls.flatMap((call) => {
    if (!isPlainObject(call) || typeof call.name !== "string") {
      return [];
    }
    const normalized: { id?: string; name: string; args: JsonValue; signature?: string } = {
      name: call.name,
      args: toJsonValue(call.args ?? {}),
    };
    const id = stringFrom(call.id);
    const signature = thoughtSignatureFrom(call);
    if (id !== undefined) {
      normalized.id = id;
    }
    if (signature !== undefined) {
      normalized.signature = signature;
    }
    return [normalized];
  });

  return [...normalizedDirectCalls, ...partCalls];
}

function functionCallFromGeminiPart(
  call: Record<string, unknown>,
  part: Record<string, unknown>,
): { id?: string | undefined; name: string; args: JsonValue; signature?: string } | undefined {
  if (typeof call.name !== "string") {
    return undefined;
  }
  const normalized: { id?: string; name: string; args: JsonValue; signature?: string } = {
    name: call.name,
    args: toJsonValue(call.args ?? {}),
  };
  const id = stringFrom(call.id);
  const signature = thoughtSignatureFrom(part) ?? thoughtSignatureFrom(call);
  if (id !== undefined) {
    normalized.id = id;
  }
  if (signature !== undefined) {
    normalized.signature = signature;
  }
  return normalized;
}

function candidateParts(response: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  return candidates.flatMap((candidate) => {
    if (!isPlainObject(candidate) || !isPlainObject(candidate.content)) {
      return [];
    }
    return Array.isArray(candidate.content.parts)
      ? candidate.content.parts.filter(isPlainObject)
      : [];
  });
}

function primaryGeminiCandidate(
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates.filter(isPlainObject)
    : [];
  return candidates.find((candidate) => candidate.index === 0) ?? candidates[0];
}

function usageFromGemini(usage: unknown): Usage {
  const raw = isPlainObject(usage) ? usage : {};
  const promptInputTokens = numberFrom(raw.promptTokenCount);
  const toolInputTokens = numberFrom(raw.toolUsePromptTokenCount);
  const inputTokens = promptInputTokens + toolInputTokens;
  const candidateOutputTokens = numberFrom(raw.candidatesTokenCount);
  const reasoningOutputTokens = numberFrom(raw.thoughtsTokenCount);
  const outputTokens = candidateOutputTokens + reasoningOutputTokens;
  const cachedInputTokens = Math.min(promptInputTokens, numberFrom(raw.cachedContentTokenCount));
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    details: {
      input: promptInputTokens - cachedInputTokens,
      input_cached_tokens: cachedInputTokens,
      input_tool_use_tokens: toolInputTokens,
      output: candidateOutputTokens,
      output_reasoning_tokens: reasoningOutputTokens,
      total: totalTokens,
    },
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function thoughtSignatureFrom(value: Record<string, unknown>): string | undefined {
  return stringFrom(value.thoughtSignature) ?? stringFrom(value.thought_signature);
}

function toolCallDelta(
  id: string,
  values: {
    callId?: string | undefined;
    name?: string | undefined;
    argumentsDelta?: string | undefined;
    argumentsMode?: ToolCallArgumentsMode | undefined;
    signature?: string | undefined;
  },
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  if (values.argumentsMode !== undefined) event.argumentsMode = values.argumentsMode;
  if (values.signature !== undefined) event.signature = values.signature;
  return event;
}
