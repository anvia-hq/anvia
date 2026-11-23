import type { JsonObject, JsonValue } from "./json-types";
import type { ContextUsage, Usage } from "./usage";

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

/** Normalized finish reasons:
 *
 * - `stop`: the model finished naturally
 * - `length`: an output token limit was hit
 * - `content-filter`: output was blocked by a safety filter
 * - `tool-calls`: the model stopped to request tool calls
 * - `other`: any provider-specific reason
 */
export type CompletionFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "other";

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

/** Joins the text parts of assistant content with newlines. */
export function textFromAssistantContent(content: readonly AssistantContentPart[]): string {
  return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
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

function isCompletionFinishReason(value: JsonValue | undefined): value is CompletionFinishReason {
  return (
    value === "stop" ||
    value === "length" ||
    value === "content-filter" ||
    value === "tool-calls" ||
    value === "other"
  );
}
