import { type Message, textFromAssistantContent } from "@anvia/core/completion";
import type {
  AgentGenerationEndArgs,
  AgentGenerationStartArgs,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunEventArgs,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolStartArgs,
} from "@anvia/core/observability";
import {
  type Attributes,
  type Context,
  context,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import type { OtelTracingOptions } from "./types.js";

export function rootSpanName(args: AgentRunStartArgs): string {
  return args.agentName === undefined || args.agentName.length === 0
    ? "agent.run"
    : `agent.${args.agentName}`;
}

export function runStartAttributes(
  args: AgentRunStartArgs,
  serviceName: string | undefined,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "service.name": serviceName,
    "anvia.agent.name": args.agentName,
    "anvia.agent.description": args.agentDescription,
    "anvia.agent.instructions": capturedString(args.instructions, "input", options),
    "anvia.run.max_turns": args.maxTurns,
    "anvia.run.prompt": capturedJson(args.prompt, "input", options),
    "anvia.run.history": capturedJson(args.history, "input", options),
    "anvia.trace.name": args.trace?.name ?? args.agentName,
    "anvia.trace.user_id": args.trace?.userId,
    "anvia.trace.session_id": args.trace?.sessionId,
    "anvia.trace.tags": args.trace?.tags,
    "anvia.trace.version": args.trace?.version,
    "anvia.prompt.name": args.promptRef?.name ?? args.trace?.promptRef?.name,
    "anvia.prompt.version": args.promptRef?.version ?? args.trace?.promptRef?.version,
    ...metadataAttributes("anvia.trace.metadata", args.trace?.metadata),
  });
}

export function runEventAttributes(args: AgentRunEventArgs): Attributes {
  return compactAttributes({
    "anvia.event.level": args.level,
    ...metadataAttributes("anvia.event.attributes", args.attributes),
  });
}

export function runEndAttributes(
  args: AgentRunEndArgs,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "anvia.run.output": capturedString(args.output, "output", options),
    "anvia.run.messages": capturedJson(args.messages, "output", options),
    ...usageAttributes(args.usage),
  });
}

export function runErrorAttributes(
  args: AgentRunErrorArgs,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "anvia.run.error": errorMessage(args.error),
    "anvia.run.messages": capturedJson(args.messages, "output", options),
    ...usageAttributes(args.usage),
  });
}

export function generationStartAttributes(
  args: AgentGenerationStartArgs,
  options: OtelTracingOptions = {},
): Attributes {
  const params = modelParameters(args.request);
  return compactAttributes({
    "anvia.generation.turn": args.turn,
    "anvia.generation.input": capturedJson(
      {
        instructions: args.request.instructions,
        messages: modelInputMessages(args.request.chatHistory),
      },
      "input",
      options,
    ),
    "anvia.generation.model": args.request.model ?? "default",
    "anvia.generation.tool_count": args.request.tools.length,
    "anvia.generation.has_output_schema": args.request.outputSchema !== undefined,
    "anvia.generation.provider": args.modelInfo?.provider,
    "anvia.generation.default_model": args.modelInfo?.defaultModel,
    "anvia.generation.documents": fullCapture(args.request.documents, "input", options),
    "anvia.generation.tool_definitions": fullCapture(args.request.tools, "input", options),
    "anvia.generation.provider_tools": fullCapture(args.request.providerTools, "input", options),
    "anvia.generation.output_schema": fullCapture(args.request.outputSchema, "input", options),
    "anvia.generation.additional_params": fullCapture(
      args.request.additionalParams,
      "input",
      options,
    ),
    "anvia.generation.provider_request": fullCapture(args.providerRequest, "input", options),
    ...params,
  });
}

export function modelInputMessage(message: Message): Message {
  if (message.metadata === undefined) {
    return message;
  }
  const result: Message = { ...message };
  delete result.metadata;
  return result;
}

export function modelInputMessages(messages: Message[]): Message[] {
  return messages.map(modelInputMessage);
}

export function generationEndAttributes(
  args: AgentGenerationEndArgs,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "anvia.generation.turn": args.turn,
    "anvia.generation.message_id": args.response.messageId,
    "anvia.generation.output": capturedJson(args.response.choice, "output", options),
    "anvia.generation.output_text": capturedString(
      textFromAssistantContent(args.response.choice),
      "output",
      options,
    ),
    "anvia.generation.first_delta_ms": args.firstDeltaMs,
    ...usageAttributes(args.response.usage),
  });
}

export function toolStartAttributes(
  args: AgentToolStartArgs,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.args": capturedString(args.args, "input", options),
    "anvia.tool.call": capturedJson(args.toolCall, "input", options),
    "anvia.tool.definition": fullCapture(args.toolDefinition, "input", options),
    "anvia.tool.metadata": fullCapture(args.toolMetadata, "input", options),
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

export function toolEndAttributes(
  args: AgentToolEndArgs,
  options: OtelTracingOptions = {},
): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.result": capturedString(args.result, "output", options),
    "anvia.tool.skipped": args.skipped,
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

export function toolErrorAttributes(args: AgentToolErrorArgs): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.error": errorMessage(args.error),
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

function usageAttributes(usage: AgentRunEndArgs["usage"]): Attributes {
  return {
    "anvia.usage.input_tokens": usage.inputTokens,
    "anvia.usage.output_tokens": usage.outputTokens,
    "anvia.usage.total_tokens": usage.totalTokens,
    "anvia.usage.cached_input_tokens": usage.cachedInputTokens,
    "anvia.usage.cache_creation_input_tokens": usage.cacheCreationInputTokens,
  };
}

export function usageAttributesFromRecord(usage: Record<string, unknown>): Attributes {
  return compactAttributes({
    "anvia.usage.input_tokens": numberValue(usage.inputTokens),
    "anvia.usage.output_tokens": numberValue(usage.outputTokens),
    "anvia.usage.total_tokens": numberValue(usage.totalTokens),
    "anvia.usage.cached_input_tokens": numberValue(usage.cachedInputTokens),
    "anvia.usage.cache_creation_input_tokens": numberValue(usage.cacheCreationInputTokens),
  });
}

function modelParameters(
  request: AgentGenerationStartArgs["request"],
): Record<string, string | number | undefined> {
  return {
    "anvia.generation.temperature": request.temperature,
    "anvia.generation.max_tokens": request.maxTokens,
    "anvia.generation.tool_choice":
      request.toolChoice === undefined
        ? undefined
        : typeof request.toolChoice === "string"
          ? request.toolChoice
          : request.toolChoice.name,
  };
}

function metadataAttributes(
  prefix: string,
  metadata: Record<string, unknown> | undefined,
): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const serialized = serializeMetadataValue(value);
    if (serialized !== undefined) {
      attributes[`${prefix}.${key}`] = serialized;
    }
  }
  return attributes;
}

export function compactAttributes(values: Record<string, Attributes[string]>): Attributes {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, NonNullable<Attributes[string]>] => {
      const [, value] = entry;
      return value !== undefined;
    }),
  );
}

export function parentContextFromTraceId(traceId: string | undefined): Context {
  if (!isValidTraceId(traceId)) {
    return context.active();
  }
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: "0000000000000001",
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function generationKey(agentId: string, turn: number): string {
  return `${agentId}:${turn}`;
}

export function agentLabel(agentId: string, agentName: string | undefined): string {
  return (agentName ?? agentId).replaceAll(/\s+/g, "_");
}

function isValidTraceId(traceId: string | undefined): traceId is string {
  return (
    traceId !== undefined &&
    /^[0-9a-f]{32}$/i.test(traceId) &&
    traceId !== "00000000000000000000000000000000"
  );
}

export function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : errorMessage(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessage(error),
  });
}

export function jsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<failed to serialize>";
  }
}

function fullCapture(
  value: unknown,
  direction: "input" | "output",
  options: OtelTracingOptions,
): string | undefined {
  return options.captureMode === "full" && value !== undefined
    ? capturedJson(value, direction, options)
    : undefined;
}

export function capturedJson(
  value: unknown,
  direction: "input" | "output",
  options: OtelTracingOptions,
): string | undefined {
  if (options.captureMode === "safe") return undefined;
  const transform = direction === "input" ? options.transformInput : options.transformOutput;
  return boundString(jsonString(transform?.(value) ?? value), options.captureMaxBytes);
}

export function capturedString(
  value: string | undefined,
  direction: "input" | "output",
  options: OtelTracingOptions,
): string | undefined {
  if (value === undefined || options.captureMode === "safe") return undefined;
  const transform = direction === "input" ? options.transformInput : options.transformOutput;
  const transformed = transform?.(value) ?? value;
  return boundString(
    typeof transformed === "string" ? transformed : jsonString(transformed),
    options.captureMaxBytes,
  );
}

function boundString(value: string, maxBytes: number | undefined): string {
  if (maxBytes === undefined || !Number.isFinite(maxBytes) || maxBytes <= 0) return value;
  const byteLimit = Math.floor(maxBytes);
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= byteLimit) return value;

  const suffix = new TextEncoder().encode("<truncated>");
  if (byteLimit <= suffix.byteLength) {
    return new TextDecoder().decode(suffix.slice(0, byteLimit));
  }

  const prefixLimit = byteLimit - suffix.byteLength;
  const prefix = decodeUtf8Prefix(bytes, prefixLimit);
  return `${prefix}<truncated>`;
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  for (let length = Math.min(bytes.byteLength, maxBytes); length > 0; length -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, length));
    } catch {
      // Retry without an incomplete trailing code point.
    }
  }
  return "";
}

function serializeMetadataValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return jsonString(value);
}

export function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
