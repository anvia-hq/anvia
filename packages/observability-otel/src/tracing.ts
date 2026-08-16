import type { Message } from "@anvia/core/completion";
import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunEventArgs,
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
  type Attributes,
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
  capturedJson,
  capturedString,
  compactAttributes,
  emptyToUndefined,
  generationEndAttributes,
  generationKey,
  generationStartAttributes,
  isRecord,
  modelInputMessage,
  modelInputMessages,
  parentContextFromTraceId,
  recordSpanError,
  rootSpanName,
  runEndAttributes,
  runErrorAttributes,
  runEventAttributes,
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
  private readonly options: OtelTracingOptions;

  constructor(options: OtelTracingOptions) {
    this.options = options;
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
        attributes: runStartAttributes(args, this.serviceName, this.options),
      },
      parentContext,
    );

    return new OtelRunObserver(this.tracer, root, this.options);
  }
}

class OtelRunObserver implements AgentRunObserver {
  readonly trace: AgentTraceInfo;
  private readonly rootContext: Context;

  constructor(
    private readonly tracer: Tracer,
    private readonly root: Span,
    private readonly options: OtelTracingOptions,
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
        attributes: generationStartAttributes(args, this.options),
      },
      this.rootContext,
    );
    return new OtelGenerationObserver(generation, this.options);
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const tool = this.tracer.startSpan(
      `tool.${args.toolName}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: toolStartAttributes(args, this.options),
      },
      this.rootContext,
    );
    return new OtelToolObserver(this.tracer, tool, this.options);
  }

  end(args: AgentRunEndArgs): void {
    this.root.setAttributes(runEndAttributes(args, this.options));
    this.root.setStatus({ code: SpanStatusCode.OK });
    this.root.end();
  }

  error(args: AgentRunErrorArgs): void {
    recordSpanError(this.root, args.error);
    this.root.setAttributes(runErrorAttributes(args, this.options));
    this.root.end();
  }

  event(args: AgentRunEventArgs): void {
    this.root.addEvent(args.name, runEventAttributes(args), eventTimestamp(args.timestamp));
  }
}

function eventTimestamp(value: Date | string | undefined): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

class OtelGenerationObserver implements AgentGenerationObserver {
  constructor(
    private readonly generation: Span,
    private readonly options: OtelTracingOptions,
  ) {}

  end(args: AgentGenerationEndArgs): void {
    this.generation.setAttributes(generationEndAttributes(args, this.options));
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
    private readonly options: OtelTracingOptions,
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
      this.childGeneration(agentId, agentName, childTurn, args, agent).setAttributes(
        compactAttributes({
          "anvia.generation.input": capturedJson(
            {
              prompt: modelInputMessage(child.prompt as Message),
              history: modelInputMessages(child.history as Message[]),
            },
            "input",
            this.options,
          ),
        }),
      );
      return;
    }

    if (child.type === "generation_start" && isRecord(child.request)) {
      const generationArgs: AgentGenerationStartArgs = {
        turn: childTurn,
        request: child.request as AgentGenerationStartArgs["request"],
        ...(isRecord(child.modelInfo)
          ? { modelInfo: child.modelInfo as AgentGenerationStartArgs["modelInfo"] }
          : {}),
      };
      this.childGeneration(agentId, agentName, childTurn, args, agent).setAttributes(
        generationStartAttributes(generationArgs, this.options),
      );
      return;
    }

    if (child.type === "turn_end") {
      const generation = this.childGenerations.get(generationKey(agentId, childTurn));
      if (generation !== undefined) {
        const attributes: Attributes = {
          "anvia.child_agent.id": agentId,
          "anvia.child_agent.name": agentName,
          "anvia.child_agent.turn": childTurn,
          "anvia.generation.output": capturedJson(child.response, "output", this.options),
        };
        if (isRecord(child.response) && isRecord(child.response.usage)) {
          Object.assign(attributes, usageAttributesFromRecord(child.response.usage));
        }
        generation.setAttributes(compactAttributes(attributes));
        generation.setStatus({ code: SpanStatusCode.OK });
        generation.end();
        this.childGenerations.delete(generationKey(agentId, childTurn));
      }
      return;
    }

    if (child.type === "tool_call" && isRecord(child.toolCall)) {
      const toolCall = child.toolCall;
      const toolName = typeof toolCall.toolName === "string" ? toolCall.toolName : "tool";
      const toolCallId =
        typeof toolCall.toolCallId === "string"
          ? toolCall.toolCallId
          : typeof toolCall.callId === "string"
            ? toolCall.callId
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
            "anvia.tool.args": capturedJson(toolCall.input, "input", this.options),
            "anvia.parent_tool.name": args.toolName,
            "anvia.parent_tool.internal_call_id": args.internalCallId,
            "anvia.parent_tool.call_id": args.toolCallId,
          }),
        },
        trace.setSpan(ROOT_CONTEXT, agent),
      );
      const childTool: (typeof this.childTools)[number] = {
        agentId,
        toolName,
        span,
        ended: false,
      };
      if (toolCallId !== undefined) childTool.toolCallId = toolCallId;
      this.childTools.push(childTool);
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
            "anvia.tool.args": capturedString(
              typeof child.args === "string" ? child.args : undefined,
              "input",
              this.options,
            ),
            "anvia.tool.result": capturedString(
              typeof child.result === "string" ? child.result : undefined,
              "output",
              this.options,
            ),
          }),
        );
        span.span.setStatus({ code: SpanStatusCode.OK });
        span.span.end();
      }
      return;
    }

    if (child.type === "final") {
      const result = isRecord(child.result) ? child.result : {};
      const attributes: Attributes = {
        "anvia.child_agent.status": typeof result.status === "string" ? result.status : undefined,
        "anvia.child_agent.text": capturedString(
          typeof result.text === "string" ? result.text : undefined,
          "output",
          this.options,
        ),
        "anvia.child_agent.output": capturedJson(result.output, "output", this.options),
        "anvia.child_agent.messages": capturedJson(result.messages, "output", this.options),
      };
      if (isRecord(result.usage)) {
        Object.assign(attributes, usageAttributesFromRecord(result.usage));
      }
      agent.setAttributes(compactAttributes(attributes));
      agent.setStatus({ code: SpanStatusCode.OK });
      agent.end();
      this.childAgents.delete(agentId);
      return;
    }

    if (child.type === "error") {
      if (isRecord(child.usage)) {
        agent.setAttributes(compactAttributes(usageAttributesFromRecord(child.usage)));
      }
      recordSpanError(agent, child.error);
      agent.end();
      this.childAgents.delete(agentId);
    }
  }

  end(args: AgentToolEndArgs): void {
    this.endOpenChildren();
    this.tool.setAttributes(toolEndAttributes(args, this.options));
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

  private childGeneration(
    agentId: string,
    agentName: string | undefined,
    turn: number,
    args: AgentToolStartArgs,
    agent: Span,
  ): Span {
    const key = generationKey(agentId, turn);
    const existing = this.childGenerations.get(key);
    if (existing !== undefined) return existing;
    const generation = this.tracer.startSpan(
      `${agentLabel(agentId, agentName)}.model.turn.${turn}`,
      {
        kind: SpanKind.CLIENT,
        attributes: compactAttributes({
          "anvia.child_agent.id": agentId,
          "anvia.child_agent.name": agentName,
          "anvia.child_agent.turn": turn,
          "anvia.parent_tool.name": args.toolName,
          "anvia.parent_tool.internal_call_id": args.internalCallId,
          "anvia.parent_tool.call_id": args.toolCallId,
        }),
      },
      trace.setSpan(ROOT_CONTEXT, agent),
    );
    this.childGenerations.set(key, generation);
    return generation;
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
