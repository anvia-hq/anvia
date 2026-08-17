import type { ModelContextLimits } from "@anvia/core/completion";
import {
  type AssistantContentPart,
  assertCompletionRequestSupported,
  type CompletionModelCapabilities,
  type CompletionModelInfo,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionSource,
  type FilePart,
  type ImagePart,
  type JsonObject,
  type JsonValue,
  type Message as MessageType,
  type ModelCallOptions,
  type ProviderTool,
  type ProviderToolCall,
  type ReasoningDetail,
  type ReasoningPart,
  type StreamingCompletionModel,
  type ToolCallPart,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultContentPart,
  type ToolResultPart,
  type UserContentPart,
  withContextUsage,
} from "@anvia/core/completion";
import type { OpenAI } from "openai";
import { orderedRequestMessages } from "../request-messages";
import {
  isPlainObject,
  normalizeOpenAIUsage,
  numberFrom,
  parseToolArguments,
  schemaName,
  stringFrom,
} from "../utils";
import type { OpenAICompletionModelId } from "./models";

type ResponsesCreateParams = Record<string, unknown>;
type ResponsesInputItem = Record<string, unknown>;

export class OpenAIResponsesCompletionModel implements StreamingCompletionModel<unknown> {
  readonly provider = "openai";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
  };

  constructor(
    private readonly client: OpenAI,
    readonly modelId: OpenAICompletionModelId,
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
    const params = toOpenAIResponsesParams(this.modelId, request);
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
    const params = toOpenAIResponsesParams(this.modelId, request);
    const response = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    return withContextUsage(fromOpenAIResponse(response), this.modelInfo());
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertCompletionRequestSupported(this, request, { streaming: true });
    const params = { ...toOpenAIResponsesParams(this.modelId, request), stream: true };
    const stream = await this.client.responses.create(
      params as never,
      openAIRequestOptions(options),
    );
    for await (const event of stream as unknown as AsyncIterable<unknown>) {
      const mapped = fromOpenAIStreamEvent(event);
      if (mapped !== undefined) {
        yield mapped.type === "final"
          ? {
              ...mapped,
              response: withContextUsage(mapped.response, this.modelInfo()),
            }
          : mapped;
      }
    }
  }
}

export function toOpenAIResponsesParams(
  modelId: OpenAICompletionModelId,
  request: CompletionRequest,
): ResponsesCreateParams {
  const providerOptions = isPlainObject(request.providerOptions) ? request.providerOptions : {};
  const params: ResponsesCreateParams = {
    ...providerOptions,
    model: modelId,
    input: requestMessages(request).flatMap(messageToResponsesInput),
  };

  delete params.tools;

  if (request.instructions !== undefined) {
    params.instructions = request.instructions;
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    params.max_output_tokens = request.maxTokens;
  }

  if (request.toolChoice !== undefined) {
    params.tool_choice = toolChoiceToOpenAI(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    params.text = {
      format: {
        type: "json_schema",
        name: schemaName(request.outputSchema),
        strict: true,
        schema: request.outputSchema,
      },
    };
  }

  const tools = [
    ...request.tools.map(toolDefinitionToOpenAI),
    ...(request.providerTools ?? []).map(providerToolToOpenAI),
  ];
  if (tools.length > 0) {
    params.tools = tools;
  } else {
    delete params.tools;
  }

  return params;
}

function openAIRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  maxRetries: 0;
} {
  return { signal: options?.abortSignal, maxRetries: 0 };
}

function providerRequestSummary(
  params: ResponsesCreateParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  const summarizedTools = Array.isArray(params.tools) ? params.tools : [];
  return compactJsonObject({
    provider: "openai",
    api: "responses",
    stream: options.stream === true,
    model: stringFrom(params.model),
    parameterKeys: Object.keys(params).sort(),
    inputCount: Array.isArray(params.input) ? params.input.length : undefined,
    toolCount: summarizedTools.length,
    toolNames: summarizedTools.flatMap((tool) => {
      if (!isPlainObject(tool)) {
        return [];
      }
      const name = stringFrom(tool.name) ?? stringFrom(tool.type);
      return name === undefined ? [] : [name];
    }),
    hasInstructions: typeof params.instructions === "string" && params.instructions.length > 0,
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
    return value.map((item) => toJsonValue(item));
  }
  if (isPlainObject(value)) {
    return compactJsonObject(value);
  }
  return String(value);
}

function requestMessages(request: CompletionRequest): MessageType[] {
  return orderedRequestMessages(request);
}

export function fromOpenAIResponse(response: unknown): CompletionResponse {
  const raw = response as Record<string, unknown>;
  const output = Array.isArray(raw.output) ? raw.output : [];
  const choice: AssistantContentPart[] = [];
  const providerToolCalls: ProviderToolCall[] = [];

  for (const item of output) {
    if (!isPlainObject(item)) {
      continue;
    }

    if (item.type === "message") {
      choice.push(...messageOutputToAssistantContent(item));
    }

    if (item.type === "function_call") {
      const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
      const callId = typeof item.call_id === "string" ? item.call_id : undefined;
      const name = typeof item.name === "string" ? item.name : "";
      const argsText = typeof item.arguments === "string" ? item.arguments : "{}";
      let toolCall: ToolCallPart = {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: parseToolArguments(id, argsText),
      };
      if (callId !== undefined) toolCall = { ...toolCall, callId };
      choice.push(toolCall);
    }

    if (item.type === "reasoning") {
      choice.push(reasoningItemToAssistantContent(item));
    }

    const providerToolCall = providerToolCallFromOutputItem(item);
    if (providerToolCall !== undefined) {
      providerToolCalls.push(providerToolCall);
    }
  }

  const sources = sourcesFromOpenAIResponse(raw, output);
  const result: CompletionResponse = {
    choice,
    usage: usageFromOpenAIResponse(raw.usage),
    rawResponse: response,
  };

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }
  if (sources.length > 0) {
    result.sources = sources;
  }
  if (providerToolCalls.length > 0) {
    result.providerToolCalls = providerToolCalls;
  }

  return result;
}

export function fromOpenAIStreamEvent(event: unknown): CompletionModelStreamEvent | undefined {
  if (!isPlainObject(event) || typeof event.type !== "string") {
    return undefined;
  }

  if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
    return typeof event.delta === "string" ? { type: "text_delta", delta: event.delta } : undefined;
  }

  if (
    event.type === "response.reasoning_text.delta" ||
    event.type === "response.reasoning_summary_text.delta"
  ) {
    if (typeof event.delta !== "string") {
      return undefined;
    }
    const mapped: CompletionModelStreamEvent = { type: "reasoning_delta", delta: event.delta };
    const id = stringFrom(event.item_id);
    if (id !== undefined) {
      mapped.id = id;
    }
    if (event.type === "response.reasoning_summary_text.delta") {
      mapped.contentType = "summary";
    } else {
      mapped.contentType = "text";
    }
    return mapped;
  }

  if (event.type === "response.output_item.added" && isPlainObject(event.item)) {
    const item = event.item;
    if (item.type === "function_call") {
      return toolCallDelta(
        stringFrom(item.id) ?? stringFrom(event.item_id) ?? crypto.randomUUID(),
        {
          callId: stringFrom(item.call_id),
          name: stringFrom(item.name),
          argumentsDelta: typeof item.arguments === "string" ? item.arguments : undefined,
        },
      );
    }
    if (typeof item.id === "string") {
      const providerToolCall = providerToolCallFromOutputItem(item);
      return providerToolCall === undefined
        ? { type: "message_id", id: item.id }
        : { type: "provider_tool_call", toolCall: providerToolCall };
    }
  }

  if (event.type === "response.output_text.annotation.added" && isPlainObject(event.annotation)) {
    const source = sourceFromAnnotation(event.annotation);
    return source === undefined ? undefined : { type: "source", source };
  }

  if (event.type === "response.function_call_arguments.delta") {
    return toolCallDelta(
      stringFrom(event.item_id) ?? stringFrom(event.output_item_id) ?? crypto.randomUUID(),
      {
        argumentsDelta: typeof event.delta === "string" ? event.delta : undefined,
      },
    );
  }

  if (event.type === "response.function_call_arguments.done") {
    return toolCallDelta(
      stringFrom(event.item_id) ?? stringFrom(event.output_item_id) ?? crypto.randomUUID(),
      {
        name: stringFrom(event.name),
        argumentsDelta: typeof event.arguments === "string" ? event.arguments : undefined,
        argumentsMode: "replace",
      },
    );
  }

  if (event.type === "response.output_item.done" && isPlainObject(event.item)) {
    const item = event.item;
    if (item.type === "function_call") {
      const id = stringFrom(item.id) ?? crypto.randomUUID();
      const callId = stringFrom(item.call_id);
      let toolCall: ToolCallPart = {
        type: "tool-call",
        toolCallId: id,
        toolName: stringFrom(item.name) ?? "",
        input: parseToolArguments(id, typeof item.arguments === "string" ? item.arguments : "{}"),
      };
      if (callId !== undefined) toolCall = { ...toolCall, callId };
      return {
        type: "tool_call",
        toolCall,
      };
    }
    const providerToolCall = providerToolCallFromOutputItem(item);
    if (providerToolCall !== undefined) {
      return { type: "provider_tool_call", toolCall: providerToolCall };
    }
  }

  if (
    (event.type === "response.completed" || event.type === "response.incomplete") &&
    isPlainObject(event.response)
  ) {
    return {
      type: "final",
      response: fromOpenAIResponse(event.response),
    };
  }

  if (event.type === "response.failed" && isPlainObject(event.response)) {
    const mapped: CompletionModelStreamEvent = {
      type: "error",
      error: event.response.error ?? event.response,
    };
    if (isPlainObject(event.response.usage)) {
      mapped.usage = usageFromOpenAIResponse(event.response.usage);
    }
    return mapped;
  }

  if (event.type === "error" || event.type === "response.error") {
    return { type: "error", error: event.error ?? event };
  }

  return undefined;
}

function usageFromOpenAIResponse(usage: unknown) {
  const usageSource = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(usageSource.input_tokens);
  const outputTokens = numberFrom(usageSource.output_tokens);
  const inputDetails = isPlainObject(usageSource.input_tokens_details)
    ? usageSource.input_tokens_details
    : {};
  const outputDetails = isPlainObject(usageSource.output_tokens_details)
    ? usageSource.output_tokens_details
    : {};
  return normalizeOpenAIUsage({
    inputTokens,
    outputTokens,
    cachedInputTokens: numberFrom(inputDetails.cached_tokens),
    reasoningOutputTokens: numberFrom(outputDetails.reasoning_tokens),
  });
}

function messageToResponsesInput(message: MessageType): ResponsesInputItem[] {
  if (message.role === "system") {
    return [
      {
        role: "system",
        content: message.content,
      },
    ];
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const inputContent: ResponsesInputItem[] = [];

    for (const content of message.content) {
      inputContent.push(...userContentToOpenAIResponsesParts(content));
    }

    if (inputContent.length === 1 && inputContent[0]?.type === "input_text") {
      return [{ role: "user", content: inputContent[0].text }];
    } else if (inputContent.length > 0) {
      return [{ role: "user", content: inputContent }];
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
      return toolContentToOpenAIResponsesItem(content);
    });
  }

  const items: ResponsesInputItem[] = [];
  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
  if (text.length > 0) {
    items.push({ role: "assistant", content: text });
  }

  for (const content of message.content) {
    if (content.type === "reasoning" && content.id !== undefined) {
      items.push(reasoningToOpenAIInput(content));
    }
    if (content.type === "tool-call") {
      items.push({
        type: "function_call",
        id: content.toolCallId,
        call_id: content.callId ?? content.toolCallId,
        name: content.toolName,
        arguments: JSON.stringify(content.input),
      });
    }
    if (content.type === "image" || content.type === "file") {
      throw new Error(
        "OpenAI Responses does not support image or file content in assistant history",
      );
    }
  }

  return items;
}

function toolContentToOpenAIResponsesItem(content: ToolResultPart): ResponsesInputItem {
  return {
    type: "function_call_output",
    call_id: content.callId ?? content.toolCallId,
    output: toolResultToOpenAIResponsesOutput(content),
  };
}

function toolResultContentToOpenAIResponsesOutput(
  content: readonly ToolResultContentPart[],
): string | ResponsesInputItem[] {
  if (content.every((item) => item.type === "text")) {
    return content.map((item) => item.text).join("\n");
  }

  return content.map((item) => {
    if (item.type === "text") {
      return { type: "input_text", text: item.text };
    }
    return fileToOpenAIResponsesPart(item);
  });
}

function toolResultToOpenAIResponsesOutput(content: ToolResultPart): string | ResponsesInputItem[] {
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
  return toolResultContentToOpenAIResponsesOutput(output.value);
}

function reasoningItemToAssistantContent(item: Record<string, unknown>): ReasoningPart {
  const content = reasoningContentFromOpenAIItem(item);
  const id = stringFrom(item.id);
  const text = content
    .flatMap((detail) => (detail.type === "text" || detail.type === "summary" ? [detail.text] : []))
    .join("");
  let reasoning: ReasoningPart = {
    type: "reasoning",
    text,
  };
  if (id !== undefined) reasoning = { ...reasoning, id };
  if (content.length > 0) reasoning = { ...reasoning, details: content };
  return reasoning;
}

function reasoningContentFromOpenAIItem(item: Record<string, unknown>): ReasoningDetail[] {
  const content: ReasoningDetail[] = [];
  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (!isPlainObject(part)) {
        continue;
      }
      if (part.type === "reasoning_text" && typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
      }
    }
  }
  if (Array.isArray(item.summary)) {
    for (const summary of item.summary) {
      if (!isPlainObject(summary)) {
        continue;
      }
      if (typeof summary.text === "string") {
        content.push({ type: "summary", text: summary.text });
      }
    }
  }
  if (typeof item.encrypted_content === "string") {
    content.push({ type: "encrypted", data: item.encrypted_content });
  }
  return content;
}

function reasoningToOpenAIInput(reasoning: ReasoningPart): ResponsesInputItem {
  const item: ResponsesInputItem = {
    type: "reasoning",
    id: reasoning.id,
    summary:
      reasoning.details
        ?.filter((content): content is Extract<ReasoningDetail, { type: "summary" }> => {
          return content.type === "summary";
        })
        .map((content) => ({ type: "summary_text", text: content.text })) ?? [],
  };
  const textContent = reasoning.details?.flatMap((content) =>
    content.type === "text" ? [{ type: "reasoning_text", text: content.text }] : [],
  );
  if (textContent !== undefined && textContent.length > 0) {
    item.content = textContent;
  }
  const encrypted = reasoning.details?.find((content) => content.type === "encrypted");
  if (encrypted?.type === "encrypted") {
    item.encrypted_content = encrypted.data;
  }
  return item;
}

function userContentToOpenAIResponsesParts(content: UserContentPart): ResponsesInputItem[] {
  if (content.type === "text") {
    return [{ type: "input_text", text: content.text }];
  }

  if (content.type === "image") {
    const part: ResponsesInputItem = { type: "input_image", image_url: imageUrl(content) };
    if (content.detail !== undefined) {
      part.detail = content.detail;
    }
    return [part];
  }

  if (content.type === "file") {
    return [fileToOpenAIResponsesPart(content)];
  }

  return [];
}

function imageUrl(image: ImagePart): string {
  if (image.image.type === "url") {
    return image.image.url;
  }

  if (image.mediaType === undefined) {
    throw new Error("OpenAI Responses image data requires mediaType");
  }
  return `data:${image.mediaType};base64,${image.image.data}`;
}

function fileToOpenAIResponsesPart(file: FilePart): ResponsesInputItem {
  if (file.data.type === "text") {
    return { type: "input_text", text: file.data.text };
  }

  if (file.mediaType.startsWith("image/")) {
    return {
      type: "input_image",
      image_url:
        file.data.type === "url"
          ? file.data.url
          : `data:${file.mediaType};base64,${file.data.data}`,
      detail: "auto",
    };
  }

  if (file.mediaType !== "application/pdf") {
    throw new Error("OpenAI Responses only supports image and PDF file attachments");
  }

  if (file.data.type === "url") {
    return { type: "input_file", file_url: file.data.url };
  }

  return {
    type: "input_file",
    file_data: `data:${file.mediaType};base64,${file.data.data}`,
    filename: file.filename ?? "document.pdf",
  };
}

function toolDefinitionToOpenAI(tool: ToolDefinition): ResponsesInputItem {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function providerToolToOpenAI(tool: ProviderTool): ResponsesInputItem {
  return {
    ...(tool.configuration ?? {}),
    type: tool.name,
  };
}

function toolChoiceToOpenAI(toolChoice: ToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "required" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    name: toolChoice.name,
  };
}

function messageOutputToAssistantContent(item: Record<string, unknown>): AssistantContentPart[] {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.flatMap((part): AssistantContentPart[] => {
    if (!isPlainObject(part)) {
      return [];
    }

    if (part.type === "output_text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "refusal" && typeof part.refusal === "string") {
      return [{ type: "text", text: part.refusal }];
    }

    return [];
  });
}

const PROVIDER_TOOL_OUTPUT_TYPES = new Set([
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
  "file_search_call",
  "mcp_call",
]);

function providerToolCallFromOutputItem(
  item: Record<string, unknown>,
): ProviderToolCall | undefined {
  if (typeof item.type !== "string" || !PROVIDER_TOOL_OUTPUT_TYPES.has(item.type)) {
    return undefined;
  }
  const toolCall: ProviderToolCall = {
    id: stringFrom(item.id) ?? crypto.randomUUID(),
    name: item.type.replace(/_call$/, ""),
  };
  const status = stringFrom(item.status);
  if (status !== undefined) {
    toolCall.status = status;
  }
  const detailEntries = Object.entries(item).filter(
    ([key, value]) => key !== "id" && key !== "type" && key !== "status" && value !== undefined,
  );
  if (detailEntries.length > 0) {
    toolCall.details = compactJsonObject(Object.fromEntries(detailEntries));
  }
  return toolCall;
}

function sourcesFromOpenAIResponse(
  response: Record<string, unknown>,
  output: unknown[],
): CompletionSource[] {
  const sources: CompletionSource[] = [];
  if (Array.isArray(response.citations)) {
    for (const citation of response.citations) {
      if (typeof citation === "string") {
        sources.push({ type: "url", url: citation });
      } else if (isPlainObject(citation)) {
        const source = sourceFromAnnotation(citation);
        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }
  for (const item of output) {
    if (!isPlainObject(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (!isPlainObject(content) || !Array.isArray(content.annotations)) {
        continue;
      }
      for (const annotation of content.annotations) {
        if (!isPlainObject(annotation)) {
          continue;
        }
        const source = sourceFromAnnotation(annotation);
        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }
  return dedupeSources(sources);
}

function sourceFromAnnotation(annotation: Record<string, unknown>): CompletionSource | undefined {
  const url = stringFrom(annotation.url);
  if (url === undefined) {
    return undefined;
  }
  const source: CompletionSource = { type: "url", url };
  const title = stringFrom(annotation.title);
  if (title !== undefined) source.title = title;
  const id = stringFrom(annotation.id);
  if (id !== undefined) source.id = id;
  const startIndex = numberFromOptional(annotation.start_index ?? annotation.startIndex);
  if (startIndex !== undefined) source.startIndex = startIndex;
  const endIndex = numberFromOptional(annotation.end_index ?? annotation.endIndex);
  if (endIndex !== undefined) source.endIndex = endIndex;
  return source;
}

function numberFromOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dedupeSources(sources: CompletionSource[]): CompletionSource[] {
  const urlsWithStructuredSources = new Set(
    sources.flatMap((source) =>
      source.title !== undefined ||
      source.id !== undefined ||
      source.startIndex !== undefined ||
      source.endIndex !== undefined
        ? [source.url]
        : [],
    ),
  );
  const seen = new Set<string>();
  return sources.filter((source) => {
    const isBare =
      source.title === undefined &&
      source.id === undefined &&
      source.startIndex === undefined &&
      source.endIndex === undefined;
    if (isBare && urlsWithStructuredSources.has(source.url)) {
      return false;
    }
    const key = `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toolCallDelta(
  id: string,
  values: {
    callId?: string | undefined;
    name?: string | undefined;
    argumentsDelta?: string | undefined;
    argumentsMode?: "append" | "replace" | undefined;
  },
): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };
  if (values.callId !== undefined) event.callId = values.callId;
  if (values.name !== undefined) event.name = values.name;
  if (values.argumentsDelta !== undefined) event.argumentsDelta = values.argumentsDelta;
  if (values.argumentsMode !== undefined) event.argumentsMode = values.argumentsMode;
  return event;
}

export const openaiMessageHelpers = {
  messageToResponsesInput,
  toolDefinitionToOpenAI,
};
