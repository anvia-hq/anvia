import { AssistantContent, Message, type ToolCall, type Usage } from "@anvia/core/completion";
import { EvalOutcome } from "@anvia/core/evals";
import type { AgentGenerationStartArgs } from "@anvia/core/observability";
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
import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOtelEvalReporter, otel } from "../src/index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenTelemetry eval reporter", () => {
  it("emits a correlated GenAI evaluation result event", async () => {
    const emit = vi.fn<Logger["emit"]>();
    const logger = fakeLogger(emit);
    const reporter = createOtelEvalReporter({ logger });
    const traceId = "1234567890abcdef1234567890abcdef";
    const observationId = "1234567890abcdef";

    await reporter.report({
      run: {
        id: "run-1",
        startedAt: "2026-08-07T00:00:00.000Z",
        datasetName: "support-cases",
        datasetVersion: "v2",
        metadata: { commitSha: "abc123" },
      },
      suiteName: "rag-quality",
      case: { id: "case-1", input: "question", metadata: { scenario: "refund" } },
      output: "answer",
      trace: { traceId, observationId, responseId: "response-1" },
      metric: {
        name: "faithfulness",
        dataType: "NUMERIC",
        configId: "score-config-1",
        metadata: { threshold: 0.8 },
        evaluate: () => EvalOutcome.pass(0.9),
      },
      outcome: EvalOutcome.pass(0.9, {
        comment: "The answer is grounded.",
        metadata: { evaluation: { usage: { totalTokens: 12 } } },
      }),
    });

    expect(emit).toHaveBeenCalledOnce();
    const record = emit.mock.calls[0]?.[0] as Parameters<Logger["emit"]>[0];
    expect(record).toMatchObject({
      eventName: "gen_ai.evaluation.result",
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      attributes: {
        "gen_ai.evaluation.name": "faithfulness",
        "gen_ai.evaluation.score.value": 0.9,
        "gen_ai.evaluation.score.label": "pass",
        "gen_ai.evaluation.explanation": "The answer is grounded.",
        "gen_ai.response.id": "response-1",
        "anvia.eval.suite.name": "rag-quality",
        "anvia.eval.id": expect.any(String),
        "anvia.eval.run.id": "run-1",
        "anvia.eval.run.started_at": "2026-08-07T00:00:00.000Z",
        "anvia.eval.run.dataset.name": "support-cases",
        "anvia.eval.run.dataset.version": "v2",
        "anvia.eval.run.metadata": { commitSha: "abc123" },
        "anvia.eval.case.id": "case-1",
        "anvia.eval.outcome": "pass",
        "anvia.eval.data_type": "NUMERIC",
        "anvia.eval.config_id": "score-config-1",
        "anvia.eval.case.metadata": { scenario: "refund" },
        "anvia.eval.metric.metadata": { threshold: 0.8 },
        "anvia.eval.outcome.metadata": { evaluation: { usage: { totalTokens: 12 } } },
      },
    });
    expect(trace.getSpanContext(record.context as Context)).toMatchObject({
      traceId,
      spanId: observationId,
    });
  });

  it("emits evaluation run lifecycle events", async () => {
    const emit = vi.fn<Logger["emit"]>();
    const reporter = createOtelEvalReporter({ logger: fakeLogger(emit) });
    const run = {
      id: "run-1",
      startedAt: "2026-08-07T00:00:00.000Z",
      datasetName: "support-cases",
      datasetVersion: "v2",
      metadata: { commitSha: "abc123" },
    };

    await reporter.onRunStart?.({
      run,
      suiteName: "release-gate",
      caseCount: 2,
      metricNames: ["quality", "safety"],
    });
    await reporter.onRunEnd?.({
      run,
      suiteName: "release-gate",
      caseCount: 2,
      metricNames: ["quality", "safety"],
      status: "completed",
      completedAt: "2026-08-07T00:00:02.000Z",
      durationMs: 2_000,
      passed: 3,
      failed: 1,
      invalid: 0,
    });

    expect(emit.mock.calls.map(([record]) => record.eventName)).toEqual([
      "anvia.eval.run.started",
      "anvia.eval.run.finished",
    ]);
    expect(emit.mock.calls[1]?.[0]).toMatchObject({
      severityNumber: SeverityNumber.INFO,
      attributes: {
        "anvia.eval.run.id": "run-1",
        "anvia.eval.run.status": "completed",
        "anvia.eval.run.passed": 3,
        "anvia.eval.run.failed": 1,
        "anvia.eval.run.invalid": 0,
      },
    });
  });

  it("emits invalid evaluations without a trace by default", async () => {
    const emit = vi.fn<Logger["emit"]>();
    const reporter = createOtelEvalReporter({ logger: fakeLogger(emit) });

    await reporter.report({
      suiteName: "quality",
      case: { id: "case-1", input: "question" },
      output: "answer",
      metric: { name: "quality", evaluate: () => EvalOutcome.invalid("missing reference") },
      outcome: EvalOutcome.invalid("missing reference"),
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityNumber: SeverityNumber.ERROR,
        attributes: expect.objectContaining({
          "gen_ai.evaluation.score.label": "invalid",
          "gen_ai.evaluation.explanation": "missing reference",
          "error.type": "evaluation_invalid",
        }),
      }),
    );
  });

  it("supports categorical scores and strict missing-trace handling", async () => {
    const emit = vi.fn<Logger["emit"]>();
    const logger = fakeLogger(emit);
    const reporter = createOtelEvalReporter({ logger, onMissingTrace: "throw" });
    const args = {
      suiteName: "quality",
      case: { id: "case-1", input: "question" },
      output: "answer",
      metric: {
        name: "tone",
        dataType: "CATEGORICAL" as const,
        evaluate: () => EvalOutcome.pass("professional"),
      },
      outcome: EvalOutcome.pass("professional"),
    };

    expect(() => reporter.report(args)).toThrow(/traceId and observationId/);
    expect(emit).not.toHaveBeenCalled();

    await createOtelEvalReporter({ logger }).report({
      ...args,
      trace: {
        traceId: "1234567890abcdef1234567890abcdef",
        observationId: "1234567890abcdef",
      },
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "gen_ai.evaluation.score.label": "professional",
          "anvia.eval.outcome": "pass",
        }),
      }),
    );
  });
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

  it("uses the generic run span name when no agent name is provided", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });

    await tracing.startRun({
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
    });

    expect(tracer.spans[0]?.name).toBe("agent.run");
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
        promptRef: { name: "support-system", version: 3 },
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
      "anvia.prompt.name": "support-system",
      "anvia.prompt.version": 3,
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

  it("omits prompt, response, and tool payloads in safe capture mode", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer, captureMode: "safe" });
    const run = await tracing.startRun({
      instructions: "private instructions",
      prompt: userMessage("private prompt"),
      history: [userMessage("private history")],
      maxTurns: 1,
    });
    const generation = await run?.startGeneration?.(generationStartArgs());
    await generation?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("private response")],
        usage: usage(2, 3),
        rawResponse: {},
      },
    });
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "private_tool",
      args: '{"secret":true}',
      toolCall: toolCall(),
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    await tool?.end({
      turn: 1,
      toolName: "private_tool",
      args: '{"secret":true}',
      toolCall: toolCall(),
      result: "private result",
      skipped: false,
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    await run?.end({ output: "private output", usage: usage(2, 3), messages: [] });

    expect(tracer.spans[0]?.attributes).not.toHaveProperty("anvia.agent.instructions");
    expect(tracer.spans[0]?.attributes).not.toHaveProperty("anvia.run.prompt");
    expect(tracer.spans[0]?.attributes).not.toHaveProperty("anvia.run.history");
    expect(tracer.spans[0]?.attributes).not.toHaveProperty("anvia.run.output");
    expect(tracer.spans[1]?.attributes).not.toHaveProperty("anvia.generation.input");
    expect(tracer.spans[1]?.attributes).not.toHaveProperty("anvia.generation.output");
    expect(tracer.spans[2]?.attributes).not.toHaveProperty("anvia.tool.args");
    expect(tracer.spans[2]?.attributes).not.toHaveProperty("anvia.tool.result");
  });

  it("never exceeds small capture byte limits", async () => {
    for (const [captureMaxBytes, expected] of [
      [1, "<"],
      [10, "<truncated"],
      [11, "<truncated>"],
    ] as const) {
      const tracer = new FakeTracer();
      const tracing = otel.create({
        tracer: tracer.tracer,
        captureMode: "full",
        captureMaxBytes,
      });

      await tracing.startRun({
        instructions: "sensitive payload",
        prompt: userMessage("hello"),
        history: [],
        maxTurns: 1,
      });

      const captured = String(tracer.spans[0]?.attributes["anvia.agent.instructions"]);
      expect(captured).toBe(expected);
      expect(new TextEncoder().encode(captured).byteLength).toBeLessThanOrEqual(captureMaxBytes);
    }
  });

  it("records ad-hoc run events", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
    });

    await run?.event?.({
      name: "retrieval.done",
      level: "WARNING",
      attributes: { documents: 4 },
      timestamp: "2026-08-07T01:02:03.000Z",
    });

    expect(tracer.spans[0]?.events).toEqual([
      expect.objectContaining({
        name: "retrieval.done",
        attributes: {
          "anvia.event.level": "WARNING",
          "anvia.event.attributes.documents": "4",
        },
      }),
    ]);
  });

  it("keeps message metadata on run transcripts but omits it from model inputs", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const metadata = { composer: { entities: [{ id: "document-1" }] } };
    const run = await tracing.startRun({
      prompt: Message.user("hello", { metadata }),
      history: [Message.user("earlier", { metadata })],
      maxTurns: 1,
    });

    const root = tracer.spans[0];
    expect(JSON.parse(String(root?.attributes["anvia.run.prompt"]))).toHaveProperty(
      "metadata",
      metadata,
    );
    expect(JSON.parse(String(root?.attributes["anvia.run.history"]))[0]).toHaveProperty(
      "metadata",
      metadata,
    );

    await run?.startGeneration?.({
      ...generationStartArgs(),
      request: {
        ...generationStartArgs().request,
        chatHistory: [Message.user("hello", { metadata })],
      },
    });
    expect(
      JSON.parse(String(tracer.spans[1]?.attributes["anvia.generation.input"]))[0],
    ).not.toHaveProperty("metadata");

    await run?.end({
      output: "done",
      usage: usage(1, 1),
      messages: [Message.assistant("done", { metadata })],
    });
    expect(JSON.parse(String(root?.attributes["anvia.run.messages"]))[0]).toHaveProperty(
      "metadata",
      metadata,
    );
  });

  it("records generation request options and output schema metadata", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
    });

    const generation = await run?.startGeneration?.({
      turn: 1,
      request: {
        model: "test-model",
        chatHistory: [userMessage("hello")],
        documents: [],
        tools: [
          {
            name: "get_ticket",
            description: "Get a ticket",
            parameters: { type: "object" },
          },
        ],
        temperature: 0.2,
        maxTokens: 128,
        toolChoice: { type: "function", name: "get_ticket" },
        additionalParams: {},
        outputSchema: { type: "object" },
      },
    });

    await generation?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("Done")],
        usage: usage(1, 1),
        rawResponse: {},
      },
    });

    expect(tracer.spans[1]?.attributes).toMatchObject({
      "anvia.generation.temperature": 0.2,
      "anvia.generation.max_tokens": 128,
      "anvia.generation.tool_choice": "get_ticket",
      "anvia.generation.tool_count": 1,
      "anvia.generation.has_output_schema": true,
    });
  });

  it("serializes unsupported trace metadata as a failure marker", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hello"),
      history: [],
      maxTurns: 1,
      trace: {
        metadata: { circular },
      },
    });

    expect(tracer.spans[0]?.attributes["anvia.trace.metadata.circular"]).toBe(
      "<failed to serialize>",
    );
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

  it("nests streamed child agent spans under the parent tool span", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 2,
    });
    const parentToolCall = AssistantContent.toolCall("call-child", "ask_child", {
      prompt: "inspect",
    });
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: { type: "turn_start", turn: 1, prompt: userMessage("inspect"), history: [] },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("call-add", "add", { x: 2, y: 5 }),
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "tool_result",
          turn: 1,
          toolName: "add",
          toolCallId: "call-add",
          internalCallId: "internal-add",
          args: '{"x":2,"y":5}',
          result: "7",
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "turn_end",
          turn: 1,
          response: {
            messageId: "msg-child",
            choice: [AssistantContent.text("7")],
            usage: usage(2, 1),
            rawResponse: {},
          },
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "final",
          runId: "child-run",
          output: "7",
          usage: usage(2, 1),
          messages: [Message.assistant("7")],
        },
      },
    });
    await tool?.end({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"inspect"}',
      toolCall: parentToolCall,
      result: "7",
      skipped: false,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    const parentTool = tracer.spans.find((span) => span.name === "tool.ask_child");
    const childAgent = tracer.spans.find((span) => span.name === "Child_Agent.run");
    const childGeneration = tracer.spans.find((span) => span.name === "Child_Agent.model.turn.1");
    const childTool = tracer.spans.find((span) => span.name === "Child_Agent.add");

    expect(childAgent?.parentSpanId).toBe(parentTool?.spanContextValue.spanId);
    expect(childGeneration?.parentSpanId).toBe(childAgent?.spanContextValue.spanId);
    expect(childTool?.parentSpanId).toBe(childAgent?.spanContextValue.spanId);
    expect(childTool?.attributes).toMatchObject({
      "anvia.parent_tool.name": "ask_child",
      "anvia.child_agent.id": "child",
      "anvia.tool.result": "7",
    });
  });

  it("applies safe capture to streamed child agent payloads", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer, captureMode: "safe" });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 2,
    });
    const parentToolCall = AssistantContent.toolCall("call-child", "ask_child", {
      prompt: "private parent prompt",
    });
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: '{"prompt":"private parent prompt"}',
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "turn_start",
          turn: 1,
          prompt: userMessage("private child prompt"),
          history: [userMessage("private child history")],
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("call-secret", "lookup", {
            query: "private tool args",
          }),
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "tool_result",
          turn: 1,
          toolName: "lookup",
          toolCallId: "call-secret",
          internalCallId: "internal-secret",
          args: '{"query":"private tool args"}',
          result: "private tool result",
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "turn_end",
          turn: 1,
          response: {
            messageId: "msg-child",
            choice: [AssistantContent.text("private child response")],
            usage: usage(2, 1),
            rawResponse: {},
          },
        },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "final",
          runId: "child-run",
          output: "private child output",
          usage: usage(2, 1),
          messages: [Message.assistant("private child message")],
        },
      },
    });

    const childAgent = tracer.spans.find((span) => span.name === "Child_Agent.run");
    const childGeneration = tracer.spans.find((span) => span.name === "Child_Agent.model.turn.1");
    const childTool = tracer.spans.find((span) => span.name === "Child_Agent.lookup");

    expect(childGeneration?.attributes).not.toHaveProperty("anvia.generation.input");
    expect(childGeneration?.attributes).not.toHaveProperty("anvia.generation.output");
    expect(childTool?.attributes).not.toHaveProperty("anvia.tool.args");
    expect(childTool?.attributes).not.toHaveProperty("anvia.tool.result");
    expect(childAgent?.attributes).not.toHaveProperty("anvia.child_agent.output");
    expect(childAgent?.attributes).not.toHaveProperty("anvia.child_agent.messages");
  });

  it("records streamed child agent errors", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 1,
    });
    const parentToolCall = AssistantContent.toolCall("call-child", "ask_child", {});
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: { type: "error", error: "child failed", usage: usage(3, 1) },
      },
    });

    const childAgent = tracer.spans.find((span) => span.name === "Child_Agent.run");
    expect(childAgent?.exceptions).toEqual(["child failed"]);
    expect(childAgent?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "child failed",
    });
    expect(childAgent?.attributes).toMatchObject({
      "anvia.usage.input_tokens": 3,
      "anvia.usage.output_tokens": 1,
    });
    expect(childAgent?.ended).toBe(true);
  });

  it("ends open streamed child spans when the parent tool ends", async () => {
    const tracer = new FakeTracer();
    const tracing = otel.create({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 1,
    });
    const parentToolCall = AssistantContent.toolCall("call-child", "ask_child", {});
    const tool = await run?.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: { type: "turn_start", turn: 1, prompt: userMessage("inspect"), history: [] },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("call-open", "open_tool", {}),
        },
      },
    });
    await tool?.end({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall: parentToolCall,
      result: "done",
      skipped: false,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    expect(tracer.spans.find((span) => span.name === "Child_Agent.run")?.ended).toBe(true);
    expect(tracer.spans.find((span) => span.name === "Child_Agent.model.turn.1")?.ended).toBe(true);
    expect(tracer.spans.find((span) => span.name === "Child_Agent.open_tool")?.ended).toBe(true);
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
  events: Array<{ name: string; attributes?: unknown; timestamp?: unknown }> = [];
  exceptions: unknown[] = [];
  status: { code: SpanStatusCode; message?: string } | undefined;
  ended = false;
  parentSpanId: string | undefined;

  constructor(
    readonly name: string,
    readonly options: SpanOptions,
    readonly spanContextValue: ReturnType<Span["spanContext"]>,
  ) {
    Object.assign(this.attributes, options.attributes);
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
    addEvent: (name, attributes, timestamp) => {
      this.events.push({ name, attributes, timestamp });
      return this.span;
    },
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

function fakeLogger(emit: Logger["emit"]): Logger {
  return {
    emit: (record) => {
      emit(record);
    },
    enabled: () => true,
  };
}
