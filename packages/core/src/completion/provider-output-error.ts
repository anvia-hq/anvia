import { isJsonValue } from "./json";
import type { CompletionFinishReason, CompletionResponse, ToolCallPart, Usage } from "./types";

export const COMPLETION_PROVIDER_OUTPUT_ERROR_CODE = "ANVIA_COMPLETION_PROVIDER_OUTPUT" as const;

export type CompletionProviderOutputErrorKind =
  | "malformed-tool-arguments"
  | "invalid-tool-arguments"
  | "invalid-stream-event"
  | "invalid-response"
  | "incomplete-stream"
  | "incomplete-tool-call"
  | "invalid-tool-call"
  | "truncated-tool-call"
  | "filtered-tool-call";

type CompletionProviderOutputErrorBaseOptions = Readonly<{
  toolCallId?: string | undefined;
  usage?: Usage | undefined;
}>;

export type CompletionProviderOutputErrorOptions =
  | Readonly<
      CompletionProviderOutputErrorBaseOptions & {
        kind: "truncated-tool-call";
        finishReason: "length";
      }
    >
  | Readonly<
      CompletionProviderOutputErrorBaseOptions & {
        kind: "filtered-tool-call";
        finishReason: "content-filter";
      }
    >
  | Readonly<
      CompletionProviderOutputErrorBaseOptions & {
        kind: Exclude<
          CompletionProviderOutputErrorKind,
          "truncated-tool-call" | "filtered-tool-call"
        >;
        finishReason?: Exclude<CompletionFinishReason, "length" | "content-filter"> | undefined;
      }
    >;

const PROVIDER_OUTPUT_ERROR_KINDS = new Set<CompletionProviderOutputErrorKind>([
  "malformed-tool-arguments",
  "invalid-tool-arguments",
  "invalid-stream-event",
  "invalid-response",
  "incomplete-stream",
  "incomplete-tool-call",
  "invalid-tool-call",
  "truncated-tool-call",
  "filtered-tool-call",
]);

/**
 * A provider returned incomplete output or a tool call that cannot be consumed safely.
 *
 * The error intentionally excludes raw model arguments. Provider output can contain
 * credentials or other sensitive values and must not become log metadata by default.
 */
export class CompletionProviderOutputError extends Error {
  readonly code = COMPLETION_PROVIDER_OUTPUT_ERROR_CODE;
  readonly kind: CompletionProviderOutputErrorKind;
  readonly toolCallId: string | undefined;
  readonly finishReason: CompletionFinishReason | undefined;
  readonly usage: Usage | undefined;

  constructor(options: CompletionProviderOutputErrorOptions) {
    assertProviderOutputErrorOptions(options);
    super(providerOutputErrorMessage(options.kind, options.toolCallId));
    this.name = "CompletionProviderOutputError";
    this.kind = options.kind;
    this.toolCallId = options.toolCallId;
    this.finishReason = options.finishReason;
    this.usage = options.usage === undefined ? undefined : copyUsage(options.usage);
  }
}

export function assertCompletionResponseIntegrity(
  options: Readonly<{ response: CompletionResponse }>,
): void {
  const { response } = options;
  const toolCalls = response.choice.filter(
    (content): content is ToolCallPart => content.type === "tool-call",
  );

  if (toolCalls.length > 0) {
    if (response.finishReason !== undefined && !isCompletionFinishReason(response.finishReason)) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        usage: response.usage,
      });
    }
    if (response.finishReason === "length") {
      throw new CompletionProviderOutputError({
        kind: "truncated-tool-call",
        finishReason: response.finishReason,
        usage: response.usage,
      });
    }
    if (response.finishReason === "content-filter") {
      throw new CompletionProviderOutputError({
        kind: "filtered-tool-call",
        finishReason: response.finishReason,
        usage: response.usage,
      });
    }
    if (response.finishReason === "other") {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-call",
        finishReason: response.finishReason,
        usage: response.usage,
      });
    }
  } else if (response.finishReason === "tool-calls") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }

  const toolCallIds = new Set<string>();
  const callIds = new Set<string>();
  for (const toolCall of toolCalls) {
    if (!isNonblankString(toolCall.toolCallId) || !isNonblankString(toolCall.toolName)) {
      throw invalidToolCall(toolCall.toolCallId, response.usage);
    }
    if (toolCall.callId !== undefined && !isNonblankString(toolCall.callId)) {
      throw invalidToolCall(toolCall.toolCallId, response.usage);
    }
    if (toolCallIds.has(toolCall.toolCallId)) {
      throw invalidToolCall(toolCall.toolCallId, response.usage);
    }
    toolCallIds.add(toolCall.toolCallId);
    if (toolCall.callId !== undefined) {
      if (callIds.has(toolCall.callId)) {
        throw invalidToolCall(toolCall.toolCallId, response.usage);
      }
      callIds.add(toolCall.callId);
    }
    if (!isJsonValue(toolCall.input)) {
      throw new CompletionProviderOutputError({
        kind: "invalid-tool-arguments",
        toolCallId: toolCall.toolCallId,
        usage: response.usage,
      });
    }
  }
}

function invalidToolCall(toolCallId: unknown, usage: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId: isNonblankString(toolCallId) ? toolCallId : undefined,
    usage,
  });
}

function assertProviderOutputErrorOptions(options: CompletionProviderOutputErrorOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("CompletionProviderOutputError options must be an object.");
  }
  if (!PROVIDER_OUTPUT_ERROR_KINDS.has(options.kind)) {
    throw new TypeError("CompletionProviderOutputError kind is invalid.");
  }
  if (options.toolCallId !== undefined && !isNonblankString(options.toolCallId)) {
    throw new TypeError("CompletionProviderOutputError toolCallId must be a non-empty string.");
  }
  if (options.finishReason !== undefined && !isCompletionFinishReason(options.finishReason)) {
    throw new TypeError("CompletionProviderOutputError finishReason is invalid.");
  }
  if (options.kind === "truncated-tool-call" && options.finishReason !== "length") {
    throw new TypeError('CompletionProviderOutputError truncated-tool-call requires "length".');
  }
  if (options.kind === "filtered-tool-call" && options.finishReason !== "content-filter") {
    throw new TypeError(
      'CompletionProviderOutputError filtered-tool-call requires "content-filter".',
    );
  }
  if (options.finishReason === "length" && options.kind !== "truncated-tool-call") {
    throw new TypeError(
      'CompletionProviderOutputError finishReason "length" requires truncated-tool-call.',
    );
  }
  if (options.finishReason === "content-filter" && options.kind !== "filtered-tool-call") {
    throw new TypeError(
      'CompletionProviderOutputError finishReason "content-filter" requires filtered-tool-call.',
    );
  }
  if (options.usage !== undefined) {
    assertUsage(options.usage);
  }
}

function providerOutputErrorMessage(
  kind: CompletionProviderOutputErrorKind,
  toolCallId: string | undefined,
): string {
  const toolCall =
    toolCallId === undefined ? "tool call" : `tool call ${JSON.stringify(displayId(toolCallId))}`;
  if (kind === "malformed-tool-arguments") {
    return `Completion provider returned ${toolCall} with malformed JSON arguments.`;
  }
  if (kind === "invalid-tool-arguments") {
    return `Completion provider returned ${toolCall} with arguments that are not a JSON value.`;
  }
  if (kind === "invalid-stream-event") {
    return "Completion provider returned an invalid stream event.";
  }
  if (kind === "invalid-response") {
    return "Completion provider returned a response that cannot be consumed safely.";
  }
  if (kind === "incomplete-tool-call") {
    return "Completion provider stream ended before its tool call was complete.";
  }
  if (kind === "incomplete-stream") {
    return "Completion provider stream ended without a terminal response.";
  }
  if (kind === "truncated-tool-call") {
    return "Completion provider stopped at its output limit before a tool call could be consumed safely.";
  }
  if (kind === "filtered-tool-call") {
    return "Completion provider content filtering prevented a tool call from being consumed safely.";
  }
  return `Completion provider returned an invalid ${toolCall}.`;
}

function displayId(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    sanitized += code <= 31 || code === 127 ? "�" : character;
  }
  return sanitized.length <= 128 ? sanitized : `${sanitized.slice(0, 127)}…`;
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCompletionFinishReason(value: unknown): value is CompletionFinishReason {
  return (
    value === "stop" ||
    value === "length" ||
    value === "content-filter" ||
    value === "tool-calls" ||
    value === "other"
  );
}

function assertUsage(usage: Usage): void {
  for (const value of [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.cachedInputTokens,
    usage.cacheCreationInputTokens,
  ]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new TypeError("CompletionProviderOutputError usage must contain finite token counts.");
    }
  }
  if (usage.details !== undefined) {
    for (const value of Object.values(usage.details)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new TypeError(
          "CompletionProviderOutputError usage details must contain finite token counts.",
        );
      }
    }
  }
}

function copyUsage(usage: Usage): Usage {
  const copied: Usage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
  if (usage.details !== undefined) copied.details = { ...usage.details };
  return copied;
}
