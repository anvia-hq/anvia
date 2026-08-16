import type { ModelCallOptions } from "../model-call-options";
import { isJsonValue } from "./json";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type Document = {
  id: string;
  text: string;
  additionalProps?: Record<string, string>;
};

export type TextPart = Readonly<{
  type: "text";
  text: string;
  signature?: string;
}>;

export type ImageDetail = "auto" | "low" | "high";

export type FileData =
  | Readonly<{ type: "url"; url: string }>
  | Readonly<{ type: "data"; data: string }>
  | Readonly<{ type: "text"; text: string }>;

export type ImagePart = Readonly<{
  type: "image";
  image: Exclude<FileData, Readonly<{ type: "text"; text: string }>>;
  mediaType?: string;
  detail?: ImageDetail;
}>;

export type FilePart = Readonly<{
  type: "file";
  data: FileData;
  mediaType: string;
  filename?: string;
}>;

export type ReasoningPart = Readonly<{
  type: "reasoning";
  text: string;
  id?: string;
  details?: readonly ReasoningDetail[];
}>;

export type ReasoningDetail =
  | Readonly<{
      type: "text";
      text: string;
      signature?: string;
    }>
  | Readonly<{
      type: "summary";
      text: string;
    }>
  | Readonly<{
      type: "encrypted";
      data: string;
    }>
  | Readonly<{
      type: "redacted";
      data: string;
    }>;

export type ReasoningContentType = ReasoningDetail["type"];

export type ToolCallPart = Readonly<{
  type: "tool-call";
  toolCallId: string;
  callId?: string;
  toolName: string;
  input: JsonValue;
  signature?: string;
}>;

export type ToolResultContentPart = TextPart | FilePart;

export type ToolResultOutput =
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "json"; value: JsonValue }>
  | Readonly<{ type: "content"; value: readonly ToolResultContentPart[] }>
  | Readonly<{ type: "execution-denied"; reason?: string }>
  | Readonly<{ type: "error-text"; value: string }>
  | Readonly<{ type: "error-json"; value: JsonValue }>;

export type ToolResultPart = Readonly<{
  type: "tool-result";
  toolCallId: string;
  callId?: string;
  toolName: string;
  output: ToolResultOutput;
}>;

export type UserContentPart = TextPart | ImagePart | FilePart;
export type AssistantContentPart = TextPart | ImagePart | FilePart | ReasoningPart | ToolCallPart;

export type SystemMessage<Metadata extends JsonObject = JsonObject> = Readonly<{
  role: "system";
  content: string;
  metadata?: Metadata;
}>;

export type UserMessage<Metadata extends JsonObject = JsonObject> = Readonly<{
  role: "user";
  content: string | readonly UserContentPart[];
  metadata?: Metadata;
}>;

export type AssistantMessage<Metadata extends JsonObject = JsonObject> = Readonly<{
  role: "assistant";
  id?: string;
  content: string | readonly AssistantContentPart[];
  metadata?: Metadata;
}>;

export type ToolMessage<Metadata extends JsonObject = JsonObject> = Readonly<{
  role: "tool";
  content: readonly ToolResultPart[];
  metadata?: Metadata;
}>;

export type Message<Metadata extends JsonObject = JsonObject> =
  | SystemMessage<Metadata>
  | UserMessage<Metadata>
  | AssistantMessage<Metadata>
  | ToolMessage<Metadata>;

export function reasoningDisplayText(
  reasoning: ReasoningPart | readonly ReasoningDetail[],
): string {
  const details = "type" in reasoning ? reasoning.details : reasoning;
  if (details === undefined) {
    return "type" in reasoning ? reasoning.text : "";
  }
  return details
    .flatMap((item) => {
      if (item.type === "text" || item.type === "summary") {
        return [item.text];
      }
      return [];
    })
    .join("");
}

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | {
      type: "function";
      name: string;
    };

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: JsonObject;
};

/**
 * A tool executed by the model provider rather than by Anvia's local tool runtime.
 *
 * Provider packages expose typed factories for these values. Application code can
 * pass them through the same high-level `tools` APIs used for local tools.
 */
export type ProviderTool = {
  kind: "provider";
  provider: string;
  name: string;
  configuration?: JsonObject;
};

export type CompletionTool = ToolDefinition | ProviderTool;

export function isProviderTool(value: unknown): value is ProviderTool {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ProviderTool>;
  return (
    candidate.kind === "provider" &&
    typeof candidate.provider === "string" &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    (candidate.configuration === undefined ||
      (typeof candidate.configuration === "object" &&
        candidate.configuration !== null &&
        !Array.isArray(candidate.configuration) &&
        isJsonValue(candidate.configuration)))
  );
}

export type CompletionSource = {
  type: "url";
  url: string;
  title?: string;
  id?: string;
  startIndex?: number;
  endIndex?: number;
};

export type ProviderToolCall = {
  id: string;
  name: string;
  status?: string;
  details?: JsonObject;
};

/**
 * Provider-normalized, mutually exclusive usage buckets.
 *
 * Every token should appear in exactly one non-total bucket. `total` is the
 * only aggregate key and should equal the sum of the other buckets.
 */
export type UsageDetails = Record<string, number>;

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  details?: UsageDetails;
};

export type ModelContextLimits = {
  contextWindow: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

export type CompletionModelInfo<ModelName extends string = string> = {
  id: ModelName;
  context: ModelContextLimits;
};

export type CompletionModelMetadataOptions = {
  modelOverrides?: Readonly<Record<string, ModelContextLimits>>;
};

export type ContextUsage<ModelName extends string = string> = {
  model: CompletionModelInfo<ModelName>;
  usedTokens: number;
  remainingTokens: number;
  usedPercent: number;
  remainingPercent: number;
};

export function calculateContextUsage<ModelName extends string>(
  usage: Usage,
  model: CompletionModelInfo<ModelName> | undefined,
): ContextUsage<ModelName> | undefined {
  if (
    model === undefined ||
    !Number.isFinite(usage.inputTokens) ||
    usage.inputTokens <= 0 ||
    !Number.isFinite(model.context.contextWindow) ||
    model.context.contextWindow <= 0
  ) {
    return undefined;
  }

  const usedTokens = Math.max(0, usage.inputTokens);
  const remainingTokens = Math.max(0, model.context.contextWindow - usedTokens);
  const usedPercent = Math.min(100, (usedTokens / model.context.contextWindow) * 100);
  return {
    model,
    usedTokens,
    remainingTokens,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}

export function withContextUsage<RawResponse, ModelName extends string>(
  response: CompletionResponse<RawResponse>,
  model: CompletionModelInfo<ModelName> | undefined,
): CompletionResponse<RawResponse> {
  const contextUsage = calculateContextUsage(response.usage, model);
  return contextUsage === undefined ? response : { ...response, contextUsage };
}

export function resolveCompletionModelInfo<ModelName extends string>(
  model: ModelName,
  catalog: Readonly<Record<string, ModelContextLimits>>,
  overrides?: Readonly<Record<string, ModelContextLimits>>,
): CompletionModelInfo<ModelName> | undefined {
  const context = overrides?.[model] ?? catalog[model];
  return context === undefined ? undefined : { id: model, context };
}

export type AssistantGenerationMetadata = {
  provider: string;
  model: string;
  usage: Usage;
  contextUsage?: ContextUsage;
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
};

export const Usage = {
  empty(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  },
  add(left: Usage, right: Usage): Usage {
    const result: Usage = {
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
      cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    };
    const details = addUsageDetails(left, right);
    if (details !== undefined) {
      result.details = details;
    }
    return result;
  },
};

function addUsageDetails(left: Usage, right: Usage): UsageDetails | undefined {
  if (isEmptyUsage(left) && left.details === undefined) {
    return right.details === undefined ? undefined : { ...right.details };
  }
  if (isEmptyUsage(right) && right.details === undefined) {
    return left.details === undefined ? undefined : { ...left.details };
  }
  if (left.details === undefined || right.details === undefined) {
    return undefined;
  }
  const details: UsageDetails = { ...left.details };
  for (const [key, value] of Object.entries(right.details)) {
    details[key] = (details[key] ?? 0) + value;
  }
  return details;
}

function isEmptyUsage(usage: Usage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.totalTokens === 0 &&
    usage.cachedInputTokens === 0 &&
    usage.cacheCreationInputTokens === 0
  );
}

export function getAssistantGenerationMetadata(
  message: Message,
): AssistantGenerationMetadata | undefined {
  if (message.role !== "assistant" || !isJsonObjectValue(message.metadata)) {
    return undefined;
  }
  const frameworkMetadata = message.metadata.anvia;
  if (!isJsonObjectValue(frameworkMetadata)) {
    return undefined;
  }
  const generation = frameworkMetadata.generation;
  if (
    !isJsonObjectValue(generation) ||
    typeof generation.provider !== "string" ||
    typeof generation.model !== "string" ||
    !isUsageValue(generation.usage)
  ) {
    return undefined;
  }
  const metadata: AssistantGenerationMetadata = {
    provider: generation.provider,
    model: generation.model,
    usage: {
      ...generation.usage,
      ...(generation.usage.details === undefined
        ? {}
        : { details: { ...generation.usage.details } }),
    },
  };
  if (isContextUsageValue(generation.contextUsage)) {
    metadata.contextUsage = {
      ...generation.contextUsage,
      model: {
        ...generation.contextUsage.model,
        context: { ...generation.contextUsage.model.context },
      },
    };
  }
  if (isCompletionSourceArray(generation.sources)) {
    metadata.sources = generation.sources.map((source) => ({ ...source }));
  }
  if (isProviderToolCallArray(generation.providerToolCalls)) {
    metadata.providerToolCalls = generation.providerToolCalls.map((toolCall) => ({
      ...toolCall,
      ...(toolCall.details === undefined ? {} : { details: { ...toolCall.details } }),
    }));
  }
  return metadata;
}

function isJsonObjectValue(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContextUsageValue(value: JsonValue | undefined): value is JsonObject & ContextUsage {
  if (!isJsonObjectValue(value) || !isJsonObjectValue(value.model)) {
    return false;
  }
  const context = value.model.context;
  if (
    typeof value.model.id === "string" &&
    isJsonObjectValue(context) &&
    isPositiveFiniteNumber(context.contextWindow) &&
    isOptionalPositiveFiniteNumber(context.maxInputTokens) &&
    isOptionalPositiveFiniteNumber(context.maxOutputTokens) &&
    isNonnegativeFiniteNumber(value.usedTokens) &&
    isNonnegativeFiniteNumber(value.remainingTokens) &&
    isPercentage(value.usedPercent) &&
    isPercentage(value.remainingPercent)
  ) {
    const contextWindow = context.contextWindow;
    const remainingTokens = Math.max(0, contextWindow - value.usedTokens);
    const usedPercent = Math.min(100, (value.usedTokens / contextWindow) * 100);
    const remainingPercent = (remainingTokens / contextWindow) * 100;
    return (
      value.remainingTokens === remainingTokens &&
      approximatelyEqual(value.usedPercent, usedPercent) &&
      approximatelyEqual(value.remainingPercent, remainingPercent)
    );
  }
  return false;
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 8;
}

function isPositiveFiniteNumber(value: JsonValue | undefined): value is number {
  return isNonnegativeFiniteNumber(value) && value > 0;
}

function isOptionalPositiveFiniteNumber(value: JsonValue | undefined): boolean {
  return value === undefined || isPositiveFiniteNumber(value);
}

function isPercentage(value: JsonValue | undefined): value is number {
  return isNonnegativeFiniteNumber(value) && value <= 100;
}

function isUsageValue(value: JsonValue | undefined): value is JsonObject & Usage {
  if (!isJsonObjectValue(value)) {
    return false;
  }
  return (
    isNonnegativeFiniteNumber(value.inputTokens) &&
    isNonnegativeFiniteNumber(value.outputTokens) &&
    isNonnegativeFiniteNumber(value.totalTokens) &&
    isNonnegativeFiniteNumber(value.cachedInputTokens) &&
    isNonnegativeFiniteNumber(value.cacheCreationInputTokens) &&
    isUsageDetailsValue(value.details)
  );
}

function isNonnegativeFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUsageDetailsValue(value: JsonValue | undefined): value is JsonObject | undefined {
  if (value === undefined) {
    return true;
  }
  if (!isJsonObjectValue(value)) {
    return false;
  }
  let total: number | undefined;
  let bucketSum = 0;
  for (const [key, detail] of Object.entries(value)) {
    if (detail === undefined || !isNonnegativeFiniteNumber(detail)) {
      return false;
    }
    if (key === "total") {
      total = detail;
    } else {
      bucketSum += detail;
    }
  }
  return total !== undefined && total === bucketSum;
}

function isCompletionSourceArray(value: JsonValue | undefined): value is CompletionSource[] {
  return (
    Array.isArray(value) &&
    value.every(
      (source) =>
        isJsonObjectValue(source) &&
        source.type === "url" &&
        typeof source.url === "string" &&
        (source.title === undefined || typeof source.title === "string") &&
        (source.id === undefined || typeof source.id === "string") &&
        (source.startIndex === undefined || typeof source.startIndex === "number") &&
        (source.endIndex === undefined || typeof source.endIndex === "number"),
    )
  );
}

function isProviderToolCallArray(value: JsonValue | undefined): value is ProviderToolCall[] {
  return (
    Array.isArray(value) &&
    value.every(
      (toolCall) =>
        isJsonObjectValue(toolCall) &&
        typeof toolCall.id === "string" &&
        typeof toolCall.name === "string" &&
        (toolCall.status === undefined || typeof toolCall.status === "string") &&
        (toolCall.details === undefined || isJsonObjectValue(toolCall.details)),
    )
  );
}

export type CompletionRequest<ModelName extends string = string> = {
  model?: ModelName;
  instructions?: string;
  chatHistory: Message[];
  documents: Document[];
  tools: ToolDefinition[];
  providerTools?: ProviderTool[];
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  providerOptions?: JsonObject;
  outputSchema?: JsonObject;
};

export type CompletionResponse<RawResponse = unknown> = {
  choice: AssistantContentPart[];
  usage: Usage;
  contextUsage?: ContextUsage;
  rawResponse: RawResponse;
  messageId?: string;
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
};

export type CompletionResult<Output = string, RawResponse = unknown> = {
  output: Output;
  text: string;
  content: readonly AssistantContentPart[];
  usage: Usage;
  contextUsage?: ContextUsage;
  rawResponse: RawResponse;
  messageId?: string;
  sources?: readonly CompletionSource[];
  providerToolCalls?: readonly ProviderToolCall[];
};

export type CompletionModelCapabilities = {
  streaming: boolean;
  tools: boolean;
  toolChoice: boolean;
  imageInput: boolean;
  documentInput: boolean;
  outputSchema: boolean;
  reasoning: boolean;
  providerTools?: boolean;
};

export interface CompletionModel<RawResponse = unknown, ModelName extends string = string> {
  readonly provider: string;
  readonly defaultModel: ModelName;
  readonly capabilities: CompletionModelCapabilities;
  getModelInfo?(model?: ModelName): CompletionModelInfo<ModelName> | undefined;
  traceRequest?(
    request: CompletionRequest<ModelName>,
    options?: { stream?: boolean | undefined },
  ): JsonObject | undefined;
  completion(
    request: CompletionRequest<ModelName>,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse<RawResponse>>;
}

export type ToolCallArgumentsMode = "append" | "replace";

export type CompletionStreamPart =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "tool_call_delta";
      id: string;
      callId?: string;
      name?: string;
      argumentsDelta?: string;
      argumentsMode?: ToolCallArgumentsMode;
      signature?: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCallPart;
    }
  | {
      type: "source";
      source: CompletionSource;
    }
  | {
      type: "provider_tool_call";
      toolCall: ProviderToolCall;
    }
  | {
      type: "message_id";
      id: string;
    };

export type CompletionModelStreamEvent<RawResponse = unknown> =
  | CompletionStreamPart
  | {
      type: "final";
      response: CompletionResponse<RawResponse>;
    }
  | {
      type: "error";
      error: unknown;
      usage?: Usage;
    };

export type CompletionStreamEvent<Output = string, RawResponse = unknown> =
  | CompletionStreamPart
  | {
      type: "final";
      result: CompletionResult<Output, RawResponse>;
    }
  | {
      type: "error";
      error: unknown;
      usage: Usage;
    };

export interface StreamingCompletionModel<RawResponse = unknown, ModelName extends string = string>
  extends CompletionModel<RawResponse, ModelName> {
  streamCompletion(
    request: CompletionRequest<ModelName>,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent<RawResponse>>;
}

export class CompletionCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCapabilityError";
  }
}

export function assertCompletionRequestSupported(
  model: CompletionModel,
  request: CompletionRequest,
  options: { streaming?: boolean | undefined } = {},
): void {
  const modelLabel = `${model.provider}:${request.model ?? model.defaultModel}`;
  const capabilities = model.capabilities;

  if (options.streaming === true && !capabilities.streaming) {
    throw new CompletionCapabilityError(`${modelLabel} does not support streaming completions.`);
  }

  if (request.tools.length > 0 && !capabilities.tools) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool definitions.`);
  }

  if ((request.providerTools?.length ?? 0) > 0 && capabilities.providerTools !== true) {
    throw new CompletionCapabilityError(`${modelLabel} does not support provider-executed tools.`);
  }

  if (request.toolChoice !== undefined && !capabilities.toolChoice) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool choice.`);
  }

  if (request.outputSchema !== undefined && !capabilities.outputSchema) {
    throw new CompletionCapabilityError(`${modelLabel} does not support output schemas.`);
  }

  if (!capabilities.imageInput && requestHasImageInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support image input.`);
  }

  if (!capabilities.documentInput && requestHasFileDocumentInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support document file input.`);
  }
}

export function textFromAssistantContent(content: readonly AssistantContentPart[]): string {
  return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function requestHasImageInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "system" || typeof message.content === "string"
      ? false
      : message.content.some((content) => content.type === "image"),
  );
}

function requestHasFileDocumentInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? message.content.some((content) => content.type === "file" && content.data.type !== "text")
      : false,
  );
}
