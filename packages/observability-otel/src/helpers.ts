import { textFromAssistantContent } from "@anvia/core/completion";
import type {
  AgentGenerationEndArgs,
  AgentGenerationStartArgs,
  AgentRunEndArgs,
  AgentRunErrorArgs,
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

export function rootSpanName(args: AgentRunStartArgs): string {
  return args.agentName === undefined || args.agentName.length === 0
    ? "agent.run"
    : `agent.${args.agentName}`;
}

export function runStartAttributes(
  args: AgentRunStartArgs,
  serviceName: string | undefined,
): Attributes {
  return compactAttributes({
    "service.name": serviceName,
    "anvia.agent.name": args.agentName,
    "anvia.agent.description": args.agentDescription,
    "anvia.agent.instructions": args.instructions,
    "anvia.run.max_turns": args.maxTurns,
    "anvia.run.prompt": jsonString(args.prompt),
    "anvia.run.history": jsonString(args.history),
    "anvia.trace.name": args.trace?.name ?? args.agentName,
    "anvia.trace.user_id": args.trace?.userId,
    "anvia.trace.session_id": args.trace?.sessionId,
    "anvia.trace.tags": args.trace?.tags,
    "anvia.trace.version": args.trace?.version,
    ...metadataAttributes("anvia.trace.metadata", args.trace?.metadata),
  });
}

export function runEndAttributes(args: AgentRunEndArgs): Attributes {
  return compactAttributes({
    "anvia.run.output": args.output,
    "anvia.run.messages": jsonString(args.messages),
    ...usageAttributes(args.usage),
  });
}

export function runErrorAttributes(args: AgentRunErrorArgs): Attributes {
  return compactAttributes({
    "anvia.run.error": errorMessage(args.error),
    "anvia.run.messages": jsonString(args.messages),
    ...usageAttributes(args.usage),
  });
}

export function generationStartAttributes(args: AgentGenerationStartArgs): Attributes {
  const params = modelParameters(args.request);
  return compactAttributes({
    "anvia.generation.turn": args.turn,
    "anvia.generation.input": jsonString(args.request.chatHistory),
    "anvia.generation.model": args.request.model ?? "default",
    "anvia.generation.tool_count": args.request.tools.length,
    "anvia.generation.has_output_schema": args.request.outputSchema !== undefined,
    ...params,
  });
}

export function generationEndAttributes(args: AgentGenerationEndArgs): Attributes {
  return compactAttributes({
    "anvia.generation.turn": args.turn,
    "anvia.generation.message_id": args.response.messageId,
    "anvia.generation.output": jsonString(args.response.choice),
    "anvia.generation.output_text": textFromAssistantContent(args.response.choice),
    "anvia.generation.first_delta_ms": args.firstDeltaMs,
    ...usageAttributes(args.response.usage),
  });
}

export function toolStartAttributes(args: AgentToolStartArgs): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.args": args.args,
    "anvia.tool.call": jsonString(args.toolCall),
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

export function toolEndAttributes(args: AgentToolEndArgs): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.result": args.result,
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
