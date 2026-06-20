import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
  AgentTraceInfo,
} from "@anvia/core/observability";
import {
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import {
  agentLabel,
  compactAttributes,
  emptyToUndefined,
  generationEndAttributes,
  generationKey,
  generationStartAttributes,
  isRecord,
  jsonString,
  parentContextFromTraceId,
  recordSpanError,
  rootSpanName,
  runEndAttributes,
  runErrorAttributes,
  runStartAttributes,
  toolEndAttributes,
  toolErrorAttributes,
  toolStartAttributes,
  usageAttributesFromRecord,
} from "./helpers.js";
import type { OtelTracing, OtelTracingOptions } from "./types.js";

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
    return new OtelToolObserver(this.tracer, tool);
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
  private readonly childAgents = new Map<string, Span>();
  private readonly childGenerations = new Map<string, Span>();
  private readonly childTools: Array<{
    agentId: string;
    toolName: string;
    toolCallId?: string;
    span: Span;
    ended: boolean;
  }> = [];
  private readonly toolContext: Context;

  constructor(
    private readonly tracer: Tracer,
    private readonly tool: Span,
  ) {
    this.toolContext = trace.setSpan(ROOT_CONTEXT, tool);
  }

  streamEvent(args: AgentToolStreamEventArgs): void {
    const wrapper = args.event;
    const child = isRecord(wrapper.event) ? wrapper.event : undefined;
    if (child === undefined) {
      return;
    }

    const agentId = wrapper.agentId;
    const agentName = wrapper.agentName;
    const childTurn = typeof child.turn === "number" ? child.turn : args.turn;
    const agent = this.childAgent(agentId, agentName, args);

    if (child.type === "turn_start") {
      const generation = this.tracer.startSpan(
        `${agentLabel(agentId, agentName)}.model.turn.${childTurn}`,
        {
          kind: SpanKind.CLIENT,
          attributes: compactAttributes({
            "anvia.child_agent.id": agentId,
            "anvia.child_agent.name": agentName,
            "anvia.child_agent.turn": childTurn,
            "anvia.parent_tool.name": args.toolName,
            "anvia.parent_tool.internal_call_id": args.internalCallId,
            "anvia.parent_tool.call_id": args.toolCallId,
            "anvia.generation.input": jsonString({
              prompt: child.prompt,
              history: child.history,
            }),
          }),
        },
        trace.setSpan(ROOT_CONTEXT, agent),
      );
      this.childGenerations.set(generationKey(agentId, childTurn), generation);
      return;
    }

    if (child.type === "turn_end") {
      const generation = this.childGenerations.get(generationKey(agentId, childTurn));
      if (generation !== undefined) {
        generation.setAttributes(
          compactAttributes({
            "anvia.child_agent.id": agentId,
            "anvia.child_agent.name": agentName,
            "anvia.child_agent.turn": childTurn,
            "anvia.generation.output": jsonString(child.response),
            ...(isRecord(child.response) && isRecord(child.response.usage)
              ? usageAttributesFromRecord(child.response.usage)
              : {}),
          }),
        );
        generation.setStatus({ code: SpanStatusCode.OK });
        generation.end();
        this.childGenerations.delete(generationKey(agentId, childTurn));
      }
      return;
    }

    if (child.type === "tool_call" && isRecord(child.toolCall)) {
      const toolCall = child.toolCall;
      const toolCallFunction = isRecord(toolCall.function) ? toolCall.function : undefined;
      const toolName = typeof toolCallFunction?.name === "string" ? toolCallFunction.name : "tool";
      const toolCallId =
        typeof toolCall.callId === "string"
          ? toolCall.callId
          : typeof toolCall.id === "string"
            ? toolCall.id
            : undefined;
      const span = this.tracer.startSpan(
        `${agentLabel(agentId, agentName)}.${toolName}`,
        {
          kind: SpanKind.INTERNAL,
          attributes: compactAttributes({
            "anvia.child_agent.id": agentId,
            "anvia.child_agent.name": agentName,
            "anvia.child_agent.turn": childTurn,
            "anvia.tool.name": toolName,
            "anvia.tool.call_id": toolCallId,
            "anvia.tool.args": jsonString(toolCallFunction?.arguments ?? {}),
            "anvia.parent_tool.name": args.toolName,
            "anvia.parent_tool.internal_call_id": args.internalCallId,
            "anvia.parent_tool.call_id": args.toolCallId,
          }),
        },
        trace.setSpan(ROOT_CONTEXT, agent),
      );
      this.childTools.push({
        agentId,
        toolName,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        span,
        ended: false,
      });
      return;
    }

    if (child.type === "tool_result") {
      const toolName = typeof child.toolName === "string" ? child.toolName : "tool";
      const toolCallId = typeof child.toolCallId === "string" ? child.toolCallId : undefined;
      const span = this.findChildTool(agentId, toolName, toolCallId);
      if (span !== undefined) {
        span.ended = true;
        span.span.setAttributes(
          compactAttributes({
            "anvia.child_agent.id": agentId,
            "anvia.child_agent.name": agentName,
            "anvia.child_agent.turn": childTurn,
            "anvia.tool.name": toolName,
            "anvia.tool.call_id": toolCallId,
            "anvia.tool.internal_call_id":
              typeof child.internalCallId === "string" ? child.internalCallId : undefined,
            "anvia.tool.args": typeof child.args === "string" ? child.args : undefined,
            "anvia.tool.result": typeof child.result === "string" ? child.result : undefined,
          }),
        );
        span.span.setStatus({ code: SpanStatusCode.OK });
        span.span.end();
      }
      return;
    }

    if (child.type === "final") {
      agent.setAttributes(
        compactAttributes({
          "anvia.child_agent.output": typeof child.output === "string" ? child.output : undefined,
          "anvia.child_agent.messages": jsonString(child.messages),
          ...(isRecord(child.usage) ? usageAttributesFromRecord(child.usage) : {}),
        }),
      );
      agent.setStatus({ code: SpanStatusCode.OK });
      agent.end();
      this.childAgents.delete(agentId);
      return;
    }

    if (child.type === "error") {
      recordSpanError(agent, child.error);
      agent.end();
      this.childAgents.delete(agentId);
    }
  }

  end(args: AgentToolEndArgs): void {
    this.endOpenChildren();
    this.tool.setAttributes(toolEndAttributes(args));
    this.tool.setStatus({ code: SpanStatusCode.OK });
    this.tool.end();
  }

  error(args: AgentToolErrorArgs): void {
    this.endOpenChildren();
    recordSpanError(this.tool, args.error);
    this.tool.setAttributes(toolErrorAttributes(args));
    this.tool.end();
  }

  private childAgent(
    agentId: string,
    agentName: string | undefined,
    args: AgentToolStartArgs,
  ): Span {
    const existing = this.childAgents.get(agentId);
    if (existing !== undefined) {
      return existing;
    }
    const span = this.tracer.startSpan(
      `${agentLabel(agentId, agentName)}.run`,
      {
        kind: SpanKind.INTERNAL,
        attributes: compactAttributes({
          "anvia.child_agent.id": agentId,
          "anvia.child_agent.name": agentName,
          "anvia.parent_tool.name": args.toolName,
          "anvia.parent_tool.internal_call_id": args.internalCallId,
          "anvia.parent_tool.call_id": args.toolCallId,
        }),
      },
      this.toolContext,
    );
    this.childAgents.set(agentId, span);
    return span;
  }

  private findChildTool(
    agentId: string,
    toolName: string,
    toolCallId: string | undefined,
  ): (typeof this.childTools)[number] | undefined {
    for (let index = this.childTools.length - 1; index >= 0; index -= 1) {
      const childTool = this.childTools[index];
      if (
        childTool === undefined ||
        childTool.ended ||
        childTool.agentId !== agentId ||
        childTool.toolName !== toolName
      ) {
        continue;
      }
      if (toolCallId === undefined || childTool.toolCallId === toolCallId) {
        return childTool;
      }
    }
    return undefined;
  }

  private endOpenChildren(): void {
    for (const generation of this.childGenerations.values()) {
      generation.end();
    }
    this.childGenerations.clear();
    for (const tool of this.childTools) {
      if (!tool.ended) {
        tool.span.end();
        tool.ended = true;
      }
    }
    for (const agent of this.childAgents.values()) {
      agent.end();
    }
    this.childAgents.clear();
  }
}
