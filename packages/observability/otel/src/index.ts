import {
  type AgentGenerationEndArgs,
  type AgentGenerationErrorArgs,
  type AgentGenerationObserver,
  type AgentGenerationStartArgs,
  type AgentObserver,
  type AgentRunEndArgs,
  type AgentRunErrorArgs,
  type AgentRunObserver,
  type AgentRunStartArgs,
  type AgentToolEndArgs,
  type AgentToolErrorArgs,
  type AgentToolObserver,
  type AgentToolStartArgs,
  type AgentTraceInfo,
  textFromAssistantContent,
} from "@anvia/core";
import {
  type Attributes,
  type Context,
  context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";

export type OtelTracingOptions = {
  tracer?: Tracer | undefined;
  tracerName?: string | undefined;
  tracerVersion?: string | undefined;
  serviceName?: string | undefined;
};

export type OtelTracing = AgentObserver;

export const otel = {
  create(options: OtelTracingOptions = {}): OtelTracing {
    return new OtelAgentObserver(options);
  },
};

class OtelAgentObserver implements OtelTracing {
  private readonly tracer: Tracer;
  private readonly serviceName: string | undefined;

  constructor(options: OtelTracingOptions) {
    this.tracer =
      options.tracer ??
      trace.getTracer(
        emptyToUndefined(options.tracerName) ?? "@anvia/otel",
        emptyToUndefined(options.tracerVersion),
      );
    this.serviceName = emptyToUndefined(options.serviceName);
  }

  startRun(args: AgentRunStartArgs): AgentRunObserver {
    const parentContext = parentContextFromTraceId(args.trace?.traceId);
    const root = this.tracer.startSpan(
      rootSpanName(args),
      {
        kind: SpanKind.INTERNAL,
        attributes: runStartAttributes(args, this.serviceName),
      },
      parentContext,
    );

    return new OtelRunObserver(this.tracer, root);
  }
}

class OtelRunObserver implements AgentRunObserver {
  readonly trace: AgentTraceInfo;
  private readonly rootContext: Context;

  constructor(
    private readonly tracer: Tracer,
    private readonly root: Span,
  ) {
    const spanContext = root.spanContext();
    this.trace = {
      traceId: spanContext.traceId,
      observationId: spanContext.spanId,
    };
    this.rootContext = trace.setSpan(ROOT_CONTEXT, root);
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    const generation = this.tracer.startSpan(
      `model.turn.${args.turn}`,
      {
        kind: SpanKind.CLIENT,
        attributes: generationStartAttributes(args),
      },
      this.rootContext,
    );
    return new OtelGenerationObserver(generation);
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const tool = this.tracer.startSpan(
      `tool.${args.toolName}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: toolStartAttributes(args),
      },
      this.rootContext,
    );
    return new OtelToolObserver(tool);
  }

  end(args: AgentRunEndArgs): void {
    this.root.setAttributes(runEndAttributes(args));
    this.root.setStatus({ code: SpanStatusCode.OK });
    this.root.end();
  }

  error(args: AgentRunErrorArgs): void {
    recordSpanError(this.root, args.error);
    this.root.setAttributes(runErrorAttributes(args));
    this.root.end();
  }
}

class OtelGenerationObserver implements AgentGenerationObserver {
  constructor(private readonly generation: Span) {}

  end(args: AgentGenerationEndArgs): void {
    this.generation.setAttributes(generationEndAttributes(args));
    this.generation.setStatus({ code: SpanStatusCode.OK });
    this.generation.end();
  }

  error(args: AgentGenerationErrorArgs): void {
    recordSpanError(this.generation, args.error);
    this.generation.setAttributes({
      "anvia.generation.turn": args.turn,
    });
    this.generation.end();
  }
}

class OtelToolObserver implements AgentToolObserver {
  constructor(private readonly tool: Span) {}

  end(args: AgentToolEndArgs): void {
    this.tool.setAttributes(toolEndAttributes(args));
    this.tool.setStatus({ code: SpanStatusCode.OK });
    this.tool.end();
  }

  error(args: AgentToolErrorArgs): void {
    recordSpanError(this.tool, args.error);
    this.tool.setAttributes(toolErrorAttributes(args));
    this.tool.end();
  }
}

function rootSpanName(args: AgentRunStartArgs): string {
  return args.agentName === undefined || args.agentName.length === 0
    ? "agent.run"
    : `agent.${args.agentName}`;
}

function runStartAttributes(args: AgentRunStartArgs, serviceName: string | undefined): Attributes {
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

function runEndAttributes(args: AgentRunEndArgs): Attributes {
  return compactAttributes({
    "anvia.run.output": args.output,
    "anvia.run.messages": jsonString(args.messages),
    ...usageAttributes(args.usage),
  });
}

function runErrorAttributes(args: AgentRunErrorArgs): Attributes {
  return compactAttributes({
    "anvia.run.error": errorMessage(args.error),
    "anvia.run.messages": jsonString(args.messages),
    ...usageAttributes(args.usage),
  });
}

function generationStartAttributes(args: AgentGenerationStartArgs): Attributes {
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

function generationEndAttributes(args: AgentGenerationEndArgs): Attributes {
  return compactAttributes({
    "anvia.generation.turn": args.turn,
    "anvia.generation.message_id": args.response.messageId,
    "anvia.generation.output": jsonString(args.response.choice),
    "anvia.generation.output_text": textFromAssistantContent(args.response.choice),
    "anvia.generation.first_delta_ms": args.firstDeltaMs,
    ...usageAttributes(args.response.usage),
  });
}

function toolStartAttributes(args: AgentToolStartArgs): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.args": args.args,
    "anvia.tool.call": jsonString(args.toolCall),
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

function toolEndAttributes(args: AgentToolEndArgs): Attributes {
  return compactAttributes({
    "anvia.tool.name": args.toolName,
    "anvia.tool.turn": args.turn,
    "anvia.tool.result": args.result,
    "anvia.tool.skipped": args.skipped,
    "anvia.tool.internal_call_id": args.internalCallId,
    "anvia.tool.call_id": args.toolCallId,
  });
}

function toolErrorAttributes(args: AgentToolErrorArgs): Attributes {
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

function compactAttributes(values: Record<string, Attributes[string]>): Attributes {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, NonNullable<Attributes[string]>] => {
      const [, value] = entry;
      return value !== undefined;
    }),
  );
}

function parentContextFromTraceId(traceId: string | undefined): Context {
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

function isValidTraceId(traceId: string | undefined): traceId is string {
  return (
    traceId !== undefined &&
    /^[0-9a-f]{32}$/i.test(traceId) &&
    traceId !== "00000000000000000000000000000000"
  );
}

function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : errorMessage(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessage(error),
  });
}

function jsonString(value: unknown): string {
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

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
