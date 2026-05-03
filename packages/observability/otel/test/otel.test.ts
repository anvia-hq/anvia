import {
  type AgentGenerationStartArgs,
  AssistantContent,
  type Message,
  type ToolCall,
  type Usage,
} from "@anvia/core";
import {
  type Attributes,
  type Context,
  type Span,
  SpanKind,
  type SpanOptions,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { otel } from "../src/index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("otel", () => {
  it("uses an explicit tracer when provided", async () => {
    const tracer = new FakeTracer();
    const getTracer = vi.spyOn(trace, "getTracer");

    const tracing = otel.create({ tracer: tracer.tracer });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
    });

    expect(getTracer).not.toHaveBeenCalled();
    expect(tracer.spans[0]?.name).toBe("agent.support");
  });

  it("falls back to the global tracer provider", () => {
    const tracer = new FakeTracer();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(tracer.tracer);

    otel.create({ tracerVersion: "1.2.3" });

    expect(getTracer).toHaveBeenCalledWith("@anvia/otel", "1.2.3");
  });

  it("maps runs, generations, tools, and attributes to OpenTelemetry spans", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer, serviceName: "cookbook" });

    const run = await tracing.startRun({
      agentName: "support",
      agentDescription: "Support agent",
      instructions: "Answer clearly.",
      prompt: userMessage("Summarize ticket"),
      history: [],
      maxTurns: 2,
      trace: {
        name: "ticket-summary",
        userId: "user-1",
        sessionId: "session-1",
        tags: ["cookbook"],
        version: "v1",
        metadata: { ticketId: "TICKET-1" },
      },
    });

    const root = tracer.spans[0];
    expect(root?.name).toBe("agent.support");
    expect(root?.options.kind).toBe(SpanKind.INTERNAL);
    expect(root?.attributes).toMatchObject({
      "service.name": "cookbook",
      "anvia.agent.name": "support",
      "anvia.agent.description": "Support agent",
      "anvia.agent.instructions": "Answer clearly.",
      "anvia.run.max_turns": 2,
      "anvia.trace.name": "ticket-summary",
      "anvia.trace.user_id": "user-1",
      "anvia.trace.session_id": "session-1",
      "anvia.trace.version": "v1",
      "anvia.trace.metadata.ticketId": "TICKET-1",
    });
    expect(root?.attributes["anvia.trace.tags"]).toEqual(["cookbook"]);
    expect(run?.trace).toEqual({
      traceId: root?.spanContextValue.traceId,
      observationId: root?.spanContextValue.spanId,
    });

    const generation = await run?.startGeneration?.(generationStartArgs());
    await generation?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("Done")],
        usage: usage(2, 3),
        rawResponse: {},
      },
      firstDeltaMs: 12,
    });
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "get_ticket",
      args: '{"id":"TICKET-1"}',
      toolCall: toolCall(),
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    await tool?.end({
      turn: 1,
      toolName: "get_ticket",
      args: '{"id":"TICKET-1"}',
      toolCall: toolCall(),
      result: '{"id":"TICKET-1"}',
      skipped: true,
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    await run?.end({
      output: "Done",
      usage: usage(2, 3),
      messages: [],
    });

    const generationSpan = tracer.spans[1];
    const toolSpan = tracer.spans[2];
    expect(generationSpan?.name).toBe("model.turn.1");
    expect(generationSpan?.parentSpanId).toBe(root?.spanContextValue.spanId);
    expect(generationSpan?.attributes).toMatchObject({
      "anvia.generation.turn": 1,
      "anvia.generation.model": "test-model",
      "anvia.generation.tool_count": 0,
      "anvia.generation.has_output_schema": false,
      "anvia.generation.message_id": "msg-1",
      "anvia.generation.output_text": "Done",
      "anvia.generation.first_delta_ms": 12,
      "anvia.usage.input_tokens": 2,
      "anvia.usage.output_tokens": 3,
      "anvia.usage.total_tokens": 5,
    });
    expect(generationSpan?.status).toEqual({ code: SpanStatusCode.OK });
    expect(generationSpan?.ended).toBe(true);

    expect(toolSpan?.name).toBe("tool.get_ticket");
    expect(toolSpan?.parentSpanId).toBe(root?.spanContextValue.spanId);
    expect(toolSpan?.attributes).toMatchObject({
      "anvia.tool.name": "get_ticket",
      "anvia.tool.turn": 1,
      "anvia.tool.internal_call_id": "internal-1",
      "anvia.tool.call_id": "call-1",
      "anvia.tool.skipped": true,
      "anvia.tool.result": '{"id":"TICKET-1"}',
    });
    expect(toolSpan?.status).toEqual({ code: SpanStatusCode.OK });
    expect(toolSpan?.ended).toBe(true);

    expect(root?.attributes).toMatchObject({
      "anvia.run.output": "Done",
      "anvia.usage.input_tokens": 2,
      "anvia.usage.output_tokens": 3,
      "anvia.usage.total_tokens": 5,
    });
    expect(root?.status).toEqual({ code: SpanStatusCode.OK });
    expect(root?.ended).toBe(true);
  });

  it("records run, generation, and tool errors", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
    });

    const generation = await run?.startGeneration?.(generationStartArgs());
    await generation?.error?.({ turn: 1, error: new Error("model failed") });
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "get_ticket",
      args: "{}",
      toolCall: toolCall(),
      internalCallId: "internal-1",
    });
    await tool?.error?.({
      turn: 1,
      toolName: "get_ticket",
      args: "{}",
      toolCall: toolCall(),
      internalCallId: "internal-1",
      error: "tool failed",
    });
    await run?.error?.({
      error: new Error("run failed"),
      usage: usage(0, 0),
      messages: [],
    });

    expect(tracer.spans[1]?.exceptions).toHaveLength(1);
    expect(tracer.spans[1]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "model failed",
    });
    expect(tracer.spans[2]?.exceptions).toEqual(["tool failed"]);
    expect(tracer.spans[2]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "tool failed",
    });
    expect(tracer.spans[0]?.exceptions).toHaveLength(1);
    expect(tracer.spans[0]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "run failed",
    });
    expect(tracer.spans.every((span) => span.ended)).toBe(true);
  });

  it("joins valid incoming trace ids and ignores invalid ones", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const incomingTraceId = "1234567890abcdef1234567890abcdef";

    const joined = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
      trace: { traceId: incomingTraceId },
    });
    const generated = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
      trace: { traceId: "invalid" },
    });

    expect(joined?.trace?.traceId).toBe(incomingTraceId);
    expect(tracer.spans[0]?.parentSpanId).toBe("0000000000000001");
    expect(generated?.trace?.traceId).not.toBe("invalid");
    expect(generated?.trace?.traceId).toBe(tracer.spans[1]?.spanContextValue.traceId);
  });
});

class FakeTracer {
  readonly spans: FakeSpan[] = [];
  private nextId = 2;
  readonly tracer: Tracer = {
    startSpan: (name: string, options: SpanOptions = {}, parentContext?: Context) => {
      const parent = parentContext === undefined ? undefined : trace.getSpanContext(parentContext);
      const span = new FakeSpan(name, options, {
        traceId: parent?.traceId ?? this.nextTraceId(),
        spanId: this.nextSpanId(),
        traceFlags: parent?.traceFlags ?? 1,
      });
      span.parentSpanId = parent?.spanId;
      this.spans.push(span);
      return span.span;
    },
    startActiveSpan: () => {
      throw new Error("startActiveSpan is not used by this adapter");
    },
  } as Tracer;

  private nextTraceId(): string {
    const value = this.nextId++;
    return value.toString(16).padStart(32, "0");
  }

  private nextSpanId(): string {
    const value = this.nextId++;
    return value.toString(16).padStart(16, "0");
  }
}

class FakeSpan {
  attributes: Attributes = {};
  exceptions: unknown[] = [];
  status: { code: SpanStatusCode; message?: string } | undefined;
  ended = false;
  parentSpanId: string | undefined;

  constructor(
    readonly name: string,
    readonly options: SpanOptions,
    readonly spanContextValue: ReturnType<Span["spanContext"]>,
  ) {
    this.attributes = { ...(options.attributes ?? {}) };
  }

  readonly span: Span = {
    spanContext: () => this.spanContextValue,
    setAttribute: (key, value) => {
      this.attributes[key] = value;
      return this.span;
    },
    setAttributes: (attributes) => {
      this.attributes = { ...this.attributes, ...attributes };
      return this.span;
    },
    addEvent: () => this.span,
    addLink: () => this.span,
    addLinks: () => this.span,
    setStatus: (status) => {
      this.status = status;
      return this.span;
    },
    updateName: () => this.span,
    end: () => {
      this.ended = true;
    },
    isRecording: () => true,
    recordException: (exception) => {
      this.exceptions.push(exception);
    },
  };
}

function generationStartArgs(): AgentGenerationStartArgs {
  return {
    turn: 1,
    request: {
      model: "test-model",
      chatHistory: [userMessage("hello")],
      documents: [],
      tools: [],
      additionalParams: {},
    },
  };
}

function userMessage(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function usage(inputTokens: number, outputTokens: number): Usage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function toolCall(): ToolCall {
  return AssistantContent.toolCall("call-1", "get_ticket", { id: "TICKET-1" });
}
