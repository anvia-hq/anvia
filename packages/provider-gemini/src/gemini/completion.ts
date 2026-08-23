import type { ModelContextLimits } from "@anvia/core/completion";
import {
  type AssistantContentPart,
  assertCompletionRequestSupported,
  type CompletionFinishReason,
  type CompletionModelCapabilities,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
  type CompletionResponse,
  isJsonValue,
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
type IndexedGeminiPart = Readonly<{
  index: number;
  part: GeminiPart;
}>;
type GeminiFunctionCall = Readonly<{
  toolCallId: string;
  callId?: string | undefined;
  name: string;
  args: JsonObject;
  signature?: string | undefined;
  partIndex: number;
}>;
type GeminiStreamChunkMapping = Readonly<{
  events: CompletionModelStreamEvent[];
  toolCalls: Extract<AssistantContentPart, { type: "tool-call" }>[];
  hasToolCallMarker: boolean;
  hasSyntheticToolCalls: boolean;
  providerFinishReason?: string | undefined;
  terminalError?: CompletionProviderOutputError | undefined;
}>;

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
    const streamState = new GeminiCompletionStreamState();
    for await (const chunk of stream as unknown as AsyncIterable<unknown>) {
      const mapping = mapGeminiGenerateContentStreamChunk(chunk);
      streamState.accept(chunk, mapping);
      for (const event of mapping.events) {
        if (event.type !== "final") {
          yield event;
        }
      }
    }
    streamState.assertComplete();
    const finalEvent = streamState.finalEvent();
    if (finalEvent !== undefined) {
      yield {
        ...finalEvent,
        response: withContextUsage(finalEvent.response, this.modelInfo()),
      };
    }
  }
}

export function toGeminiGenerateContentParams(
  modelId: GeminiCompletionModelId,
  request: CompletionRequest,
): GeminiGenerateParams {
  const messages = requestMessages(request);
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
      if (!isJsonValue(value)) {
        return [];
      }
      return [[key, value]];
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
  const raw = isPlainObject(response) ? response : {};
  const usage = usageFromGemini(raw.usageMetadata);
  const parts = candidateParts(raw, usage);
  const providerFinishReason = providerFinishReasonFromGeminiResponse(raw);
  const finishError = geminiToolFinishError(
    providerFinishReason,
    hasGeminiFunctionCallMarker(raw, parts),
    usage,
  );
  if (finishError !== undefined) throw finishError;
  const choice = assistantContentFromGeminiResponse(raw, usage);

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyGeminiFinishReason(result, raw);
  const id = stringFrom(raw.responseId) ?? stringFrom(raw.id);
  if (id !== undefined) {
    result.messageId = id;
  }
  assertSafeGeminiCompletionResponse(result);
  return result;
}

function applyGeminiFinishReason(
  response: CompletionResponse,
  raw: Record<string, unknown>,
  hasStreamedToolCalls = false,
): void {
  const value = providerFinishReasonFromGeminiResponse(raw);
  if (value === undefined) return;
  applyGeminiFinishReasonValue(response, value, hasStreamedToolCalls);
}

function applyGeminiFinishReasonValue(
  response: CompletionResponse,
  value: string,
  hasStreamedToolCalls: boolean,
): void {
  response.finishReason = geminiFinishReason(
    value,
    hasStreamedToolCalls || response.choice.some((part) => part.type === "tool-call"),
  );
  response.providerFinishReason = value;
}

function geminiFinishReason(value: string, hasToolCalls: boolean): CompletionFinishReason {
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
    return hasToolCalls ? "tool-calls" : "stop";
  }
  return "other";
}

export function fromGeminiGenerateContentStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  const mapping = mapGeminiGenerateContentStreamChunk(chunk);
  if (mapping.terminalError !== undefined) throw mapping.terminalError;
  return mapping.events;
}

function mapGeminiGenerateContentStreamChunk(chunk: unknown): GeminiStreamChunkMapping {
  if (!isPlainObject(chunk)) {
    return {
      events: [],
      toolCalls: [],
      hasToolCallMarker: false,
      hasSyntheticToolCalls: false,
    };
  }

  const events: CompletionModelStreamEvent[] = [];
  const usage = usageFromGemini(chunk.usageMetadata);
  const parts = candidateParts(chunk, usage);
  const providerFinishReason = providerFinishReasonFromGeminiResponse(chunk);
  const hasToolCallMarker = hasGeminiFunctionCallMarker(chunk, parts);
  const terminalError =
    providerFinishReason === undefined
      ? undefined
      : geminiToolFinishError(providerFinishReason, hasToolCallMarker, usage);
  const calls =
    terminalError === undefined ? functionCallsFromGeminiResponse(chunk, parts, usage) : [];
  const directText = textFromGeminiResponse(chunk, parts);
  if (terminalError === undefined && directText.length > 0 && parts.length === 0) {
    events.push({ type: "text_delta", delta: directText });
  }
  for (const { part } of terminalError === undefined ? parts : []) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        events.push({ type: "reasoning_delta", delta: part.text, contentType: "summary" });
      } else {
        events.push({ type: "text_delta", delta: part.text });
      }
    }
  }
  for (const call of calls) {
    events.push(
      toolCallDelta(call.toolCallId, {
        callId: call.callId,
        name: call.name,
        signature: call.signature,
      }),
    );
    const argumentsDelta = JSON.stringify(call.args);
    if (argumentsDelta === undefined) {
      throw invalidGeminiToolCallArguments(call.toolCallId, usage);
    }
    events.push(
      toolCallDelta(call.toolCallId, {
        callId: call.callId,
        argumentsDelta,
        argumentsMode: "replace",
      }),
    );
  }
  const id = stringFrom(chunk.responseId) ?? stringFrom(chunk.id);
  if (id !== undefined) {
    events.push({ type: "message_id", id });
  }
  if (isPlainObject(chunk.usageMetadata)) {
    if (terminalError === undefined) {
      events.push({ type: "final", response: fromGeminiGenerateContentResponse(chunk) });
    } else {
      const response: CompletionResponse = { choice: [], usage, rawResponse: chunk };
      if (providerFinishReason !== undefined) {
        applyGeminiFinishReasonValue(response, providerFinishReason, true);
      }
      events.push({ type: "final", response });
    }
  }
  return providerFinishReason === undefined
    ? {
        events,
        toolCalls: calls.map(toolCallFromGeminiFunctionCall),
        hasToolCallMarker,
        hasSyntheticToolCalls: calls.some((call) => call.callId === undefined),
        terminalError,
      }
    : {
        events,
        toolCalls: calls.map(toolCallFromGeminiFunctionCall),
        hasToolCallMarker,
        hasSyntheticToolCalls: calls.some((call) => call.callId === undefined),
        providerFinishReason,
        terminalError,
      };
}

class GeminiCompletionStreamState {
  private readonly toolCalls = new Map<
    string,
    Extract<AssistantContentPart, { type: "tool-call" }>
  >();
  private providerFinishReason: string | undefined;
  private terminalChunk: unknown;
  private finalResponse: CompletionResponse | undefined;
  private sawToolCallMarker = false;
  private sawSyntheticToolCallChunk = false;
  private terminalError: CompletionProviderOutputError | undefined;

  accept(chunk: unknown, mapping: GeminiStreamChunkMapping): void {
    if (mapping.hasSyntheticToolCalls && this.sawSyntheticToolCallChunk) {
      const toolCallId = mapping.toolCalls.find(
        (toolCall) => toolCall.callId === undefined,
      )?.toolCallId;
      throw toolCallId === undefined
        ? new CompletionProviderOutputError({
            kind: "invalid-tool-call",
            usage: this.currentUsage(),
          })
        : invalidGeminiToolCall(toolCallId, this.currentUsage());
    }
    if (
      this.providerFinishReason !== undefined &&
      (mapping.hasToolCallMarker || hasGeminiSemanticProgress(mapping.events))
    ) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        finishReason: "other",
        usage: this.currentUsage(),
      });
    }
    for (const toolCall of mapping.toolCalls) {
      const existing = this.toolCalls.get(toolCall.toolCallId);
      if (existing !== undefined) {
        if (
          existing.callId === undefined ||
          toolCall.callId === undefined ||
          !sameGeminiToolCall(existing, toolCall)
        ) {
          throw invalidGeminiToolCall(toolCall.toolCallId, this.currentUsage());
        }
        continue;
      }
      this.toolCalls.set(toolCall.toolCallId, toolCall);
    }
    this.sawToolCallMarker ||= mapping.hasToolCallMarker;
    this.sawSyntheticToolCallChunk ||= mapping.hasSyntheticToolCalls;
    for (const event of mapping.events) {
      if (event.type === "final") {
        this.finalResponse = event.response;
      }
    }
    this.terminalError ??= mapping.terminalError;

    if (mapping.providerFinishReason !== undefined) {
      if (
        this.providerFinishReason !== undefined &&
        this.providerFinishReason !== mapping.providerFinishReason
      ) {
        throw new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          finishReason: "other",
          usage: this.currentUsage(),
        });
      }
      this.providerFinishReason = mapping.providerFinishReason;
      this.terminalChunk = chunk;
    }
  }

  assertComplete(): void {
    if (this.terminalError !== undefined) {
      throw geminiProviderOutputErrorWithUsage(this.terminalError, this.currentUsage());
    }
    if (!this.sawToolCallMarker && this.toolCalls.size === 0) return;
    if (this.providerFinishReason !== undefined) {
      assertSafeGeminiToolFinishReason(this.providerFinishReason, this.currentUsage());
      return;
    }
    const toolCallId = this.toolCalls.keys().next().value as string | undefined;
    throw new CompletionProviderOutputError(
      toolCallId === undefined
        ? { kind: "incomplete-tool-call", usage: this.currentUsage() }
        : { kind: "incomplete-tool-call", toolCallId, usage: this.currentUsage() },
    );
  }

  finalEvent(): Extract<CompletionModelStreamEvent, { type: "final" }> | undefined {
    let response = this.finalResponse;
    if (response === undefined) {
      if (this.terminalChunk === undefined) {
        return undefined;
      }
      const raw = isPlainObject(this.terminalChunk) ? this.terminalChunk : {};
      response = {
        choice: [],
        usage: usageFromGemini(raw.usageMetadata),
        rawResponse: this.terminalChunk,
      };
      const messageId = stringFrom(raw.responseId) ?? stringFrom(raw.id);
      if (messageId !== undefined) response.messageId = messageId;
    }

    response = mergeGeminiStreamToolCalls(response, [...this.toolCalls.values()]);
    if (this.providerFinishReason !== undefined) {
      applyGeminiFinishReasonValue(response, this.providerFinishReason, this.toolCalls.size > 0);
    }
    assertSafeGeminiCompletionResponse(response);
    return { type: "final", response };
  }

  private currentUsage(): Usage {
    if (this.finalResponse !== undefined) {
      return this.finalResponse.usage;
    }
    const raw = isPlainObject(this.terminalChunk) ? this.terminalChunk : {};
    return usageFromGemini(raw.usageMetadata);
  }
}

function hasGeminiSemanticProgress(events: readonly CompletionModelStreamEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "text_delta" ||
      event.type === "reasoning_delta" ||
      event.type === "tool_call_delta" ||
      event.type === "tool_call" ||
      event.type === "provider_tool_call",
  );
}

function sameGeminiToolCall(
  left: Extract<AssistantContentPart, { type: "tool-call" }>,
  right: Extract<AssistantContentPart, { type: "tool-call" }>,
): boolean {
  return (
    left.toolName === right.toolName &&
    left.callId === right.callId &&
    left.signature === right.signature &&
    sameJsonValue(left.input, right.input)
  );
}

function sameJsonValue(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (isJsonArray(left) || isJsonArray(right)) {
    return (
      isJsonArray(left) &&
      isJsonArray(right) &&
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index];
        return rightValue !== undefined && sameJsonValue(value, rightValue);
      })
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && sameJsonValue(left[key] as JsonValue, right[key] as JsonValue),
    )
  );
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function assistantContentFromGeminiResponse(
  response: Record<string, unknown>,
  usage: Usage,
): AssistantContentPart[] {
  const parts = candidateParts(response, usage);
  const calls = functionCallsFromGeminiResponse(response, parts, usage);
  if (parts.length === 0) {
    const choice: AssistantContentPart[] = [];
    const text = textFromGeminiResponse(response, parts);
    if (text.length > 0) choice.push({ type: "text", text });
    choice.push(...calls.map(toolCallFromGeminiFunctionCall));
    return choice;
  }

  const callsByPartIndex = new Map(calls.map((call) => [call.partIndex, call]));
  const choice: AssistantContentPart[] = [];
  for (const { index, part } of parts) {
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
    const call = callsByPartIndex.get(index);
    if (call !== undefined) {
      choice.push(toolCallFromGeminiFunctionCall(call));
    }
  }
  return choice;
}

function textFromGeminiResponse(
  response: Record<string, unknown>,
  parts = candidateParts(response),
): string {
  if (parts.length > 0) {
    return parts
      .flatMap(({ part }) =>
        part.thought !== true && typeof part.text === "string" ? [part.text] : [],
      )
      .join("");
  }
  if (hasGeminiCandidatePayload(response)) {
    return "";
  }
  const directText = ownDataProperty(response, "text");
  return typeof directText === "string" ? directText : "";
}

function functionCallsFromGeminiResponse(
  response: Record<string, unknown>,
  parts: IndexedGeminiPart[],
  usage: Usage,
): GeminiFunctionCall[] {
  if (parts.length > 0) {
    const calls = parts.flatMap(({ index, part }) => {
      if (part.functionCall === undefined) {
        return [];
      }
      if (!isPlainObject(part.functionCall)) {
        throw invalidGeminiToolCall(deterministicGeminiToolCallId(index), usage);
      }
      return [functionCallFromGeminiPart(part.functionCall, part, index, usage)];
    });
    assertDistinctGeminiFunctionCalls(calls, usage);
    return calls;
  }
  if (hasGeminiCandidatePayload(response)) {
    return [];
  }

  const camelCaseCalls = ownDataProperty(response, "functionCalls");
  const snakeCaseCalls = ownDataProperty(response, "function_calls");
  const directCalls = Array.isArray(camelCaseCalls)
    ? camelCaseCalls
    : Array.isArray(snakeCaseCalls)
      ? snakeCaseCalls
      : [];
  const calls = directCalls.map((call, index) => {
    if (!isPlainObject(call)) {
      throw invalidGeminiToolCall(deterministicGeminiToolCallId(index), usage);
    }
    return functionCallFromGeminiPart(call, call, index, usage);
  });
  assertDistinctGeminiFunctionCalls(calls, usage);
  return calls;
}

function functionCallFromGeminiPart(
  call: Record<string, unknown>,
  part: Record<string, unknown>,
  partIndex: number,
  usage: Usage,
): GeminiFunctionCall {
  const fallbackId = deterministicGeminiToolCallId(partIndex);
  const rawCallId = call.id;
  const callId = isNonblankString(rawCallId) ? rawCallId : undefined;
  const toolCallId = callId ?? fallbackId;
  if (rawCallId !== undefined && callId === undefined) {
    throw invalidGeminiToolCall(toolCallId, usage);
  }
  if (
    call.partialArgs !== undefined ||
    call.partial_args !== undefined ||
    call.willContinue !== undefined ||
    call.will_continue !== undefined
  ) {
    throw new CompletionProviderOutputError({
      kind: "incomplete-tool-call",
      toolCallId,
      usage,
    });
  }
  const name = call.name;
  if (!isNonblankString(name)) {
    throw invalidGeminiToolCall(toolCallId, usage);
  }
  const args = call.args;
  if (!isPlainObject(args) || !isJsonValue(args)) {
    throw invalidGeminiToolCallArguments(toolCallId, usage);
  }

  const normalized: GeminiFunctionCall = {
    toolCallId,
    name,
    args,
    partIndex,
  };
  const signature = thoughtSignatureFrom(part) ?? thoughtSignatureFrom(call);
  if (callId !== undefined) {
    return signature === undefined
      ? { ...normalized, callId }
      : { ...normalized, callId, signature };
  }
  return signature === undefined ? normalized : { ...normalized, signature };
}

function candidateParts(response: Record<string, unknown>, usage?: Usage): IndexedGeminiPart[] {
  const candidate = primaryGeminiCandidate(response);
  if (candidate === undefined || candidate.content === undefined) {
    return [];
  }
  if (!isPlainObject(candidate.content)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }
  if (candidate.content.parts === undefined) return [];
  if (!Array.isArray(candidate.content.parts)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }
  if (candidate.content.parts.some((part) => !isPlainObject(part))) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }
  return candidate.content.parts.map((part, index) => ({
    index,
    part: part as Record<string, unknown>,
  }));
}

function primaryGeminiCandidate(
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (response.candidates === undefined) return undefined;
  if (!Array.isArray(response.candidates)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  const candidates = response.candidates;
  if (
    candidates.some(
      (candidate) =>
        !isPlainObject(candidate) ||
        (candidate.index !== undefined &&
          (!Number.isSafeInteger(candidate.index) || (candidate.index as number) < 0)),
    )
  ) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  const primaryCandidates = candidates.filter(
    (candidate): candidate is Record<string, unknown> =>
      isPlainObject(candidate) && candidate.index === 0,
  );
  if (primaryCandidates.length === 1) {
    return primaryCandidates[0];
  }
  if (primaryCandidates.length > 1) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  const candidate = candidates[0] as Record<string, unknown>;
  if (candidate.index !== undefined && candidate.index !== 0) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }
  return candidate;
}

function providerFinishReasonFromGeminiResponse(
  response: Record<string, unknown>,
): string | undefined {
  const candidateFinishReason = stringFrom(primaryGeminiCandidate(response)?.finishReason);
  if (candidateFinishReason !== undefined) return candidateFinishReason;
  const promptFeedback = response.promptFeedback ?? response.prompt_feedback;
  if (promptFeedback === undefined) return undefined;
  if (!isPlainObject(promptFeedback)) {
    throw new CompletionProviderOutputError({ kind: "invalid-response" });
  }
  const blockReason = promptFeedback.blockReason ?? promptFeedback.block_reason;
  if (blockReason === undefined) return undefined;
  if (typeof blockReason !== "string" || blockReason.length === 0) {
    throw new CompletionProviderOutputError({ kind: "invalid-response" });
  }
  return blockReason;
}

function hasGeminiCandidatePayload(response: Record<string, unknown>): boolean {
  return Array.isArray(response.candidates) && response.candidates.length > 0;
}

function hasGeminiFunctionCallMarker(
  response: Record<string, unknown>,
  parts: readonly IndexedGeminiPart[],
): boolean {
  if (parts.some(({ part }) => ownDataProperty(part, "functionCall") !== undefined)) {
    return true;
  }
  if (hasGeminiCandidatePayload(response)) return false;
  const camelCaseCalls = ownDataProperty(response, "functionCalls");
  const snakeCaseCalls = ownDataProperty(response, "function_calls");
  return (
    (Array.isArray(camelCaseCalls) && camelCaseCalls.length > 0) ||
    (Array.isArray(snakeCaseCalls) && snakeCaseCalls.length > 0)
  );
}

function deterministicGeminiToolCallId(partIndex: number): string {
  return `gemini-tool-${partIndex.toString()}`;
}

function toolCallFromGeminiFunctionCall(
  call: GeminiFunctionCall,
): Extract<AssistantContentPart, { type: "tool-call" }> {
  let toolCall: Extract<AssistantContentPart, { type: "tool-call" }> = {
    type: "tool-call",
    toolCallId: call.toolCallId,
    toolName: call.name,
    input: call.args,
  };
  if (call.callId !== undefined) toolCall = { ...toolCall, callId: call.callId };
  if (call.signature !== undefined) toolCall = { ...toolCall, signature: call.signature };
  return toolCall;
}

function mergeGeminiStreamToolCalls(
  response: CompletionResponse,
  toolCalls: readonly Extract<AssistantContentPart, { type: "tool-call" }>[],
): CompletionResponse {
  if (toolCalls.length === 0) return response;
  const finalIds = new Set(
    response.choice.flatMap((part) => (part.type === "tool-call" ? [part.toolCallId] : [])),
  );
  const missing = toolCalls.filter((toolCall) => !finalIds.has(toolCall.toolCallId));
  return missing.length === 0
    ? response
    : { ...response, choice: [...response.choice, ...missing] };
}

function assertSafeGeminiToolFinishReason(value: string, usage: Usage): void {
  const error = geminiToolFinishError(value, true, usage);
  if (error !== undefined) throw error;
}

function geminiToolFinishError(
  value: string | undefined,
  hasToolCalls: boolean,
  usage: Usage,
): CompletionProviderOutputError | undefined {
  if (value === "MALFORMED_FUNCTION_CALL") {
    return new CompletionProviderOutputError({ kind: "malformed-tool-arguments", usage });
  }
  if (value === "UNEXPECTED_TOOL_CALL" || value === "TOO_MANY_TOOL_CALLS") {
    return new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }
  if (!hasToolCalls) return undefined;
  if (value === undefined) {
    return new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }
  const finishReason = geminiFinishReason(value, true);
  if (finishReason === "tool-calls") return undefined;
  if (finishReason === "length") {
    return new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }
  if (finishReason === "content-filter") {
    return new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }
  return new CompletionProviderOutputError({ kind: "invalid-tool-call", finishReason, usage });
}

function assertSafeGeminiCompletionResponse(response: CompletionResponse): void {
  const toolCalls = response.choice.filter(
    (part): part is Extract<AssistantContentPart, { type: "tool-call" }> =>
      part.type === "tool-call",
  );
  if (toolCalls.length > 0) {
    if (response.finishReason === undefined) {
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        usage: response.usage,
      });
    }
    assertNormalizedGeminiToolFinishReason(response.finishReason, response.usage);
  } else if (toolCalls.length === 0 && response.finishReason === "tool-calls") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }

  const toolCallIds = new Set<string>();
  const callIds = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCallIds.has(toolCall.toolCallId)) {
      throw invalidGeminiToolCall(toolCall.toolCallId, response.usage);
    }
    toolCallIds.add(toolCall.toolCallId);
    if (toolCall.callId !== undefined) {
      if (callIds.has(toolCall.callId)) {
        throw invalidGeminiToolCall(toolCall.toolCallId, response.usage);
      }
      callIds.add(toolCall.callId);
    }
  }
}

function assertDistinctGeminiFunctionCalls(
  calls: readonly GeminiFunctionCall[],
  usage: Usage,
): void {
  const toolCallIds = new Set<string>();
  const callIds = new Set<string>();
  for (const call of calls) {
    if (toolCallIds.has(call.toolCallId)) {
      throw invalidGeminiToolCall(call.toolCallId, usage);
    }
    toolCallIds.add(call.toolCallId);
    if (call.callId !== undefined) {
      if (callIds.has(call.callId)) {
        throw invalidGeminiToolCall(call.toolCallId, usage);
      }
      callIds.add(call.callId);
    }
  }
}

function assertNormalizedGeminiToolFinishReason(
  finishReason: CompletionFinishReason,
  usage: Usage,
): void {
  if (finishReason === "stop" || finishReason === "tool-calls") return;
  if (finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }
  if (finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }
  throw new CompletionProviderOutputError({ kind: "invalid-tool-call", finishReason, usage });
}

function geminiProviderOutputErrorWithUsage(
  error: CompletionProviderOutputError,
  usage: Usage,
): CompletionProviderOutputError {
  if (error.kind === "truncated-tool-call") {
    return new CompletionProviderOutputError({
      kind: error.kind,
      finishReason: "length",
      toolCallId: error.toolCallId,
      usage,
    });
  }
  if (error.kind === "filtered-tool-call") {
    return new CompletionProviderOutputError({
      kind: error.kind,
      finishReason: "content-filter",
      toolCallId: error.toolCallId,
      usage,
    });
  }
  if (error.finishReason === "length" || error.finishReason === "content-filter") {
    throw error;
  }
  return new CompletionProviderOutputError({
    kind: error.kind,
    finishReason: error.finishReason,
    toolCallId: error.toolCallId,
    usage,
  });
}

function invalidGeminiToolCall(toolCallId: string, usage: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({ kind: "invalid-tool-call", toolCallId, usage });
}

function invalidGeminiToolCallArguments(
  toolCallId: string,
  usage: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-arguments",
    toolCallId,
    usage,
  });
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
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
