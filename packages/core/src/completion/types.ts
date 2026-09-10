import type { ModelCallOptions } from "../model-call-options";
import { isJsonValue } from "./json";

export type JsonPrimitive = string | number | boolean | null;
/** Any JSON-compatible value: primitives, objects, or readonly arrays of JSON values. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** A retrievable text document passed to a completion as grounding context. */
export type Document = {
  id: string;
  text: string;
  /** String metadata rendered as a `<metadata ... />` header above the text when documents are serialized into prompts. */
  additionalProps?: Record<string, string>;
};

/**
 * A text segment, optionally carrying a provider reasoning signature.
 */
export type TextPart = Readonly<{
  type: "text";
  text: string;
  /** Provider signature preserved so reasoning can be replayed on later turns. */
  signature?: string;
}>;

/** Image input fidelity hint forwarded to providers that support it. */
export type ImageDetail = "auto" | "low" | "high";

/**
 * File payload for image/file parts: a remote URL, base64 data, or literal text
 * interpreted as a document.
 */
export type FileData =
  | Readonly<{ type: "url"; url: string }>
  | Readonly<{ type: "data"; data: string }>
  | Readonly<{ type: "text"; text: string }>;

/** Image input with an optional media type override and detail hint. */
export type ImagePart = Readonly<{
  type: "image";
  image: Exclude<FileData, Readonly<{ type: "text"; text: string }>>;
  mediaType?: string;
  detail?: ImageDetail;
}>;

/** Document/file input part; non-text data is rejected by models without `documentInput`. */
export type FilePart = Readonly<{
  type: "file";
  data: FileData;
  mediaType: string;
  filename?: string;
}>;

/** Model reasoning content, replayable across turns to preserve thinking state. */
export type ReasoningPart = Readonly<{
  type: "reasoning";
  text: string;
  id?: string;
  details?: readonly ReasoningDetail[];
}>;

/**
 * Reasoning detail variants:
 *
 * - `text` / `summary`: displayable reasoning text
 * - `encrypted` / `redacted`: opaque payloads that can only be echoed back to
 *   the provider; their content is not readable by the application
 */
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

/** A tool call requested by the model; `signature` preserves provider replay state. */
export type ToolCallPart = Readonly<{
  type: "tool-call";
  toolCallId: string;
  callId?: string;
  toolName: string;
  input: JsonValue;
  signature?: string;
}>;

/** The content variants allowed inside a tool result payload. */
export type ToolResultContentPart = TextPart | FilePart;

/**
 * Outcome of one tool execution, as recorded in tool messages:
 *
 * - `text` / `json`: successful result as plain text or JSON
 * - `content`: successful result as mixed content parts
 * - `execution-denied`: the call was blocked (e.g. by a required approval)
 * - `error-text` / `error-json`: failure surfaced to the model so the run can
 *   continue instead of aborting
 */
export type ToolResultOutput =
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "json"; value: JsonValue }>
  | Readonly<{ type: "content"; value: readonly ToolResultContentPart[] }>
  | Readonly<{ type: "execution-denied"; reason?: string }>
  | Readonly<{ type: "error-text"; value: string }>
  | Readonly<{ type: "error-json"; value: JsonValue }>;

/** Tool result reported back to the model, matched to its call via `toolCallId`. */
export type ToolResultPart = Readonly<{
  type: "tool-result";
  toolCallId: string;
  callId?: string;
  toolName: string;
  output: ToolResultOutput;
}>;

/** Human decision on a tool call that required approval before execution. */
export type ToolApprovalResponsePart = Readonly<{
  type: "tool-approval-response";
  interactionId: string;
  toolCallId: string;
  callId?: string;
  toolName: string;
  approved: boolean;
  reason?: string;
}>;

/** Answer to one question asked by a tool suspended on a human interaction. */
export type ToolQuestionAnswer = Readonly<{
  questionId: string;
  value: string;
}>;

/** Answers to tool questions, delivered back through the suspended run. */
export type ToolQuestionResponsePart = Readonly<{
  type: "tool-question-response";
  interactionId: string;
  toolCallId: string;
  callId?: string;
  toolName: string;
  answers: readonly ToolQuestionAnswer[];
}>;

/** A tool or human-interaction response delivered inside a `role: "tool"` message. */
export type ToolInteractionResponsePart = ToolApprovalResponsePart | ToolQuestionResponsePart;

/** Content parts allowed in user messages. */
export type UserContentPart = TextPart | ImagePart | FilePart;
/** Content parts allowed in assistant messages, including replayed reasoning and tool calls. */
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
  content: readonly (ToolResultPart | ToolInteractionResponsePart)[];
  metadata?: Metadata;
}>;

/**
 * A conversation message from the system, user, assistant, or tool role.
 *
 * Framework-generated metadata (provider, model, usage of the generation that
 * produced an assistant message) is stored under the `anvia` key of `metadata`;
 * read it back with {@link getAssistantGenerationMetadata}.
 */
export type Message<Metadata extends JsonObject = JsonObject> =
  | SystemMessage<Metadata>
  | UserMessage<Metadata>
  | AssistantMessage<Metadata>
  | ToolMessage<Metadata>;

/** Joins the human-readable text of a reasoning part or its details. */
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

/**
 * How the model may call tools: freely, mandatorily, never, or a named function.
 * Requires the model's `toolChoice` capability.
 */
export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | {
      type: "function";
      name: string;
    };

/** JSON Schema-shaped tool description sent to the model (a local tool's public face). */
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

/** Narrows an unknown value to a well-formed {@link ProviderTool}. */
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

/** A grounding source (e.g. web result) returned by the provider, with optional text offsets. */
export type CompletionSource = {
  type: "url";
  url: string;
  title?: string;
  id?: string;
  startIndex?: number;
  endIndex?: number;
};

/** A tool call executed on the provider side, surfaced for observability. */
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

/**
 * Token usage for one or more generations.
 *
 * `cachedInputTokens` counts input tokens served from the provider's prompt
 * cache; `cacheCreationInputTokens` counts input tokens billed for writing to
 * that cache. Both are subsets of `inputTokens`.
 */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  details?: UsageDetails;
};

/** Model context window bounds; unset input/output caps fall back to the window. */
export type ModelContextLimits = {
  contextWindow: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

/** Identifies a model together with its context limits. */
export type CompletionModelInfo = {
  modelId: string;
  context: ModelContextLimits;
};

/** Snapshot of how much of a model's context window a request consumed. */
export type ContextUsage = {
  model: CompletionModelInfo;
  usedTokens: number;
  remainingTokens: number;
  usedPercent: number;
  remainingPercent: number;
};

/** Computes context usage, or undefined when the model or usage data is unusable. */
export function calculateContextUsage(
  usage: Usage,
  model: CompletionModelInfo | undefined,
): ContextUsage | undefined {
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

/** Attaches context usage to a response when model limits are known. */
export function withContextUsage<RawResponse>(
  response: CompletionResponse<RawResponse>,
  model: CompletionModelInfo | undefined,
): CompletionResponse<RawResponse> {
  const contextUsage = calculateContextUsage(response.usage, model);
  return contextUsage === undefined ? response : { ...response, contextUsage };
}

/** Resolves a model's context limits: explicit override wins over catalog lookup. */
export function resolveModelContextLimits(
  modelId: string,
  catalog: Readonly<Record<string, ModelContextLimits>>,
  override?: ModelContextLimits,
): ModelContextLimits | undefined {
  return override ?? catalog[modelId];
}

/** Provider/model/usage metadata embedded in assistant message metadata by the runtime. */
export type AssistantGenerationMetadata = {
  provider: string;
  modelId: string;
  usage: Usage;
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
};

/**
 * Helpers for constructing and combining token usage.
 */
export const Usage = {
  /** Returns an all-zero usage value. */
  empty(): Usage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  },
  /**
   * Sums two usage values bucket by bucket. `details` are merged only when
   * both sides carry them; if either side omits them, the result omits them.
   */
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
  /** Returns true when every bucket, including `details`, is zero. */
  isEmpty(usage: Usage): boolean {
    return (
      isEmptyUsage(usage) &&
      (usage.details === undefined || Object.values(usage.details).every((value) => value === 0))
    );
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

/**
 * Reads the generation metadata the runtime embeds in assistant messages, when
 * present and structurally valid.
 */
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
    typeof generation.modelId !== "string" ||
    !isUsageValue(generation.usage)
  ) {
    return undefined;
  }
  let usage: Usage = { ...generation.usage };
  if (generation.usage.details !== undefined) {
    usage = { ...usage, details: { ...generation.usage.details } };
  }
  const metadata: AssistantGenerationMetadata = {
    provider: generation.provider,
    modelId: generation.modelId,
    usage,
  };
  if (isCompletionFinishReason(generation.finishReason)) {
    metadata.finishReason = generation.finishReason;
  }
  if (typeof generation.providerFinishReason === "string") {
    metadata.providerFinishReason = generation.providerFinishReason;
  }
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
    metadata.providerToolCalls = generation.providerToolCalls.map((toolCall) => {
      let copy: ProviderToolCall = { ...toolCall };
      if (toolCall.details !== undefined) {
        copy = { ...copy, details: { ...toolCall.details } };
      }
      return copy;
    });
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
    typeof value.model.modelId === "string" &&
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

/** Provider-agnostic completion request assembled by the runtime for adapters. */
export type CompletionRequest = {
  instructions?: string;
  chatHistory: Message[];
  documents: Document[];
  tools: ToolDefinition[];
  providerTools?: ProviderTool[];
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  /** Values for the model's declared completion controls; validated before sending. */
  controls?: Readonly<Record<string, string>>;
  /** Provider-specific passthrough options; never validated by the core runtime. */
  providerOptions?: JsonObject;
  /** JSON Schema the output must conform to; requires the `outputSchema` capability. */
  outputSchema?: JsonObject;
};

/** Normalized finish reasons:
 *
 * - `stop`: the model finished naturally
 * - `length`: an output token limit was hit
 * - `content-filter`: output was blocked by a safety filter
 * - `tool-calls`: the model stopped to request tool calls
 * - `other`: any provider-specific reason
 */
export type CompletionFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "other";

/** A provider's raw completion response: normalized parts plus usage and metadata. */
export type CompletionResponse<RawResponse = unknown> = {
  choice: AssistantContentPart[];
  usage: Usage;
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
  /** The provider SDK's original response object, unmodified. */
  rawResponse: RawResponse;
  messageId?: string;
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
};

/** Final result of a completion: typed output, plain text, full content, and usage. */
export type CompletionResult<Output = string, RawResponse = unknown> = {
  /**
   * The typed output. When an output schema was requested this is the parsed,
   * validated object; otherwise it is the plain text.
   */
  output: Output;
  /** The generated text, joined from the response's text parts. */
  text: string;
  /** Every content part the model produced, including reasoning and tool calls. */
  content: readonly AssistantContentPart[];
  usage: Usage;
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
  rawResponse: RawResponse;
  messageId?: string;
  sources?: readonly CompletionSource[];
  providerToolCalls?: readonly ProviderToolCall[];
};

function isCompletionFinishReason(value: JsonValue | undefined): value is CompletionFinishReason {
  return (
    value === "stop" ||
    value === "length" ||
    value === "content-filter" ||
    value === "tool-calls" ||
    value === "other"
  );
}

/** Feature flags a model declares; requests are validated against these at runtime. */
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

/** A selectable model control exposed to applications (e.g. "reasoning effort"). */
export type CompletionModelSelectControl<Option extends string = string> = Readonly<{
  type: "select";
  label: string;
  options: readonly Option[];
  description?: string | undefined;
  defaultValue?: Option | undefined;
}>;

/** Named set of controls a model supports, keyed by control id. */
export type CompletionModelControls = Readonly<
  Record<string, CompletionModelSelectControl<string>>
>;

/** Marker type for models that accept no completion controls. */
export type NoCompletionModelControls = Readonly<Record<string, never>>;

/** The option values a model's controls accept, keyed by control id. */
export type CompletionControlValues<Controls extends CompletionModelControls> = Readonly<
  Partial<{
    [Key in keyof Controls]: Controls[Key] extends CompletionModelSelectControl<infer Option>
      ? Option
      : never;
  }>
>;

/** Extracts a model's control types, defaulting to the open controls record. */
export type CompletionModelControlsOf<Model> =
  Model extends CompletionModel<unknown, infer Controls> ? Controls : CompletionModelControls;

/**
 * The provider-agnostic model contract every adapter implements: non-streaming
 * completions plus capability, context, and control metadata.
 */
export interface CompletionModel<
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> {
  readonly provider: string;
  readonly modelId: string;
  readonly contextLimits?: ModelContextLimits | undefined;
  readonly capabilities: CompletionModelCapabilities;
  readonly controls?: Controls | undefined;
  /**
   * Returns a JSON-safe representation of the outgoing request for
   * observability traces, or undefined to omit the trace payload. Errors
   * thrown here are swallowed by the runtime and recorded as a trace error.
   */
  traceRequest?(
    request: CompletionRequest,
    options?: { stream?: boolean | undefined },
  ): JsonObject | undefined;
  completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse<RawResponse>>;
}

/** How a `tool_call_delta` updates arguments: append to, or replace, accumulated JSON. */
export type ToolCallArgumentsMode = "append" | "replace";

/**
 * Incremental completion stream content:
 *
 * - `text_delta` / `reasoning_delta`: incremental text or reasoning content
 * - `tool_call_delta`: partial tool call input; argument fragments accumulate
 *   according to `argumentsMode` (`append` continues the JSON string, `replace`
 *   restarts it)
 * - `tool_call`: a complete tool call
 * - `source`: a grounding source discovered during generation
 * - `provider_tool_call`: progress on a provider-executed tool
 * - `message_id`: the id of the message being generated
 */
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
      /** Provider signature preserved for reasoning replay. */
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

/** Raw model stream events: stream parts, the final response, or a terminal error. */
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

/** High-level stream events: stream parts, the final typed result, or a terminal error. */
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

/** A completion model that can additionally stream events as they are produced. */
export interface StreamingCompletionModel<
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> extends CompletionModel<RawResponse, Controls> {
  streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent<RawResponse>>;
}

/** Thrown when a request uses a capability the target model does not declare. */
export class CompletionCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCapabilityError";
  }
}

/** Validates a request against a model's declared capabilities; throws {@link CompletionCapabilityError}. */
export function assertCompletionRequestSupported(
  model: CompletionModel,
  request: CompletionRequest,
  options: { streaming?: boolean | undefined } = {},
): void {
  const modelLabel = `${model.provider}:${model.modelId}`;
  const capabilities = model.capabilities;

  assertCompletionControlsSupported(model, request.controls);

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

/** Validates control values against a model's controls; throws {@link CompletionCapabilityError}. */
export function assertCompletionControlsSupported(
  model: CompletionModel,
  controls: Readonly<Record<string, string | undefined>> | undefined,
): void {
  const modelLabel = `${model.provider}:${model.modelId}`;
  for (const [controlId, value] of Object.entries(controls ?? {})) {
    if (value === undefined) continue;
    const modelControls = model.controls;
    const control =
      modelControls !== undefined && Object.hasOwn(modelControls, controlId)
        ? modelControls[controlId]
        : undefined;
    if (control === undefined) {
      throw new CompletionCapabilityError(
        `${modelLabel} does not support completion control "${controlId}".`,
      );
    }
    if (!control.options.includes(value)) {
      throw new CompletionCapabilityError(
        `${modelLabel} completion control "${controlId}" does not support value "${value}".`,
      );
    }
  }
}

/** Joins the text parts of assistant content with newlines. */
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
