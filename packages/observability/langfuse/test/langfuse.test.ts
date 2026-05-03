import {
  type AgentGenerationStartArgs,
  type AgentRunObserver,
  type AgentToolObserver,
  AssistantContent,
  EvalOutcome,
  type Message,
  runEvalSuite,
  type Usage,
} from "@anvia/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLangfuseEvalReporter as createReporter, langfuse } from "../src/index";

const mocks = vi.hoisted(() => ({
  forceFlush: vi.fn(),
  shutdown: vi.fn(),
  sdkStart: vi.fn(),
  processorConstructor: vi.fn(),
  sdkConstructor: vi.fn(),
  startObservation: vi.fn(),
}));

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class LangfuseSpanProcessor {
    forceFlush = mocks.forceFlush;

    constructor(options: unknown) {
      mocks.processorConstructor(options);
    }
  },
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class NodeSDK {
    start = mocks.sdkStart;
    shutdown = mocks.shutdown;

    constructor(options: unknown) {
      mocks.sdkConstructor(options);
    }
  },
}));

vi.mock("@langfuse/tracing", () => ({
  LangfuseOtelSpanAttributes: {
    TRACE_NAME: "langfuse.trace.name",
    TRACE_USER_ID: "langfuse.trace.user_id",
    TRACE_SESSION_ID: "langfuse.trace.session_id",
    TRACE_TAGS: "langfuse.trace.tags",
    TRACE_METADATA: "langfuse.trace.metadata",
  },
  startObservation: mocks.startObservation,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("langfuse", () => {
  it("creates tracing from explicit options and delegates lifecycle methods", async () => {
    const tracing = langfuse.create({
      publicKey: "public",
      secretKey: "secret",
      baseUrl: "https://langfuse.test",
      environment: "test",
      release: "release-1",
    });

    expect(mocks.processorConstructor).toHaveBeenCalledWith({
      publicKey: "public",
      secretKey: "secret",
      baseUrl: "https://langfuse.test",
      environment: "test",
      release: "release-1",
    });
    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      spanProcessors: [expect.any(Object)],
    });
    expect(mocks.sdkStart).toHaveBeenCalledOnce();

    await tracing.flush();
    await tracing.shutdown();

    expect(mocks.forceFlush).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it("maps runs, generations, tools, and trace attributes to Langfuse observations", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    const tool = fakeObservation("tool", "trace-1", "obs-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation).mockReturnValueOnce(tool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "option-public",
      secretKey: "option-secret",
      baseUrl: "https://option.test",
    });
    const run = await tracing.startRun({
      agentName: "support",
      agentDescription: "Support agent",
      prompt: userMessage("Summarize ticket"),
      history: [],
      maxTurns: 2,
      trace: {
        name: "ticket-summary",
        userId: "user-1",
        sessionId: "session-1",
        tags: ["cookbook"],
        metadata: { ticketId: "TICKET-1" },
      },
    });

    expect(run?.trace).toEqual({ traceId: "trace-1", observationId: "obs-root" });
    expect(mocks.startObservation).toHaveBeenCalledWith(
      "support",
      expect.objectContaining({
        input: { prompt: userMessage("Summarize ticket"), history: [] },
        metadata: expect.objectContaining({
          agentName: "support",
          agentDescription: "Support agent",
          maxTurns: 2,
          ticketId: "TICKET-1",
        }),
      }),
      { asType: "agent" },
    );
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.name",
      "ticket-summary",
    );
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith("langfuse.trace.user_id", "user-1");
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.session_id",
      "session-1",
    );
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith("langfuse.trace.tags", ["cookbook"]);
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.metadata.ticketId",
      "TICKET-1",
    );

    const runObserver = run as AgentRunObserver;
    const generationObserver = await runObserver.startGeneration?.(generationStartArgs());
    await generationObserver?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("Done")],
        usage: usage(2, 3),
        rawResponse: {},
      },
      firstDeltaMs: 12,
    });
    const toolObserver = (await runObserver.startTool?.({
      turn: 1,
      toolName: "get_ticket",
      args: '{"id":"TICKET-1"}',
      toolCall: AssistantContent.toolCall("call-1", "get_ticket", { id: "TICKET-1" }),
      internalCallId: "internal-1",
      toolCallId: "call-1",
    })) as AgentToolObserver | undefined;
    await toolObserver?.end({
      turn: 1,
      toolName: "get_ticket",
      args: '{"id":"TICKET-1"}',
      toolCall: AssistantContent.toolCall("call-1", "get_ticket", { id: "TICKET-1" }),
      result: '{"id":"TICKET-1"}',
      skipped: false,
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    await runObserver.end({
      output: "Done",
      usage: usage(2, 3),
      messages: [],
    });

    expect(turn.startObservation).toHaveBeenCalledWith(
      "model.turn.1",
      expect.objectContaining({
        model: "test-model",
        metadata: { turn: 1, toolCount: 0, hasOutputSchema: false },
      }),
      { asType: "generation" },
    );
    expect(generation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ text: "Done" }),
        usageDetails: expect.objectContaining({ inputTokens: 2, outputTokens: 3, totalTokens: 5 }),
      }),
    );
    expect(turn.startObservation).toHaveBeenCalledWith(
      "tool.get_ticket",
      expect.objectContaining({ metadata: expect.objectContaining({ toolCallId: "call-1" }) }),
      { asType: "tool" },
    );
    expect(tool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: '{"id":"TICKET-1"}',
        level: "DEFAULT",
      }),
    );
    expect(root.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: "Done",
        metadata: expect.objectContaining({ messages: [] }),
      }),
    );
    expect(root.end).toHaveBeenCalledOnce();
  });

  it("scores traces through the Langfuse public API", async () => {
    const tracing = langfuse.create({
      publicKey: "public",
      secretKey: "secret",
      baseUrl: "https://langfuse.test",
    });

    await tracing.score({
      traceId: "trace-1",
      observationId: "obs-1",
      name: "quality",
      value: 1,
      comment: "good",
      metadata: { source: "test" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://langfuse.test/api/public/scores",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from("public:secret").toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      }),
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      traceId: "trace-1",
      observationId: "obs-1",
      name: "quality",
      value: 1,
      comment: "good",
      metadata: { source: "test" },
    });
  });

  it("validates score requirements", async () => {
    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    await expect(tracing.score({ traceId: "", name: "quality", value: 1 })).rejects.toThrow(
      "Langfuse score requires traceId",
    );

    const missingKeys = langfuse.create({ publicKey: "", secretKey: "" });
    await expect(
      missingKeys.score({ traceId: "trace-1", name: "quality", value: 1 }),
    ).rejects.toThrow("Langfuse score requires publicKey and secretKey");
  });

  it("reports eval outcomes as Langfuse scores", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { output: "answer", trace: { traceId: "trace-1", observationId: "obs-1" } },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true, { comment: "good" }),
    });

    expect(score).toHaveBeenCalledWith({
      traceId: "trace-1",
      observationId: "obs-1",
      name: "quality",
      value: 1,
      comment: "good",
      metadata: {
        suiteName: "suite",
        caseId: "case-1",
        outcome: "pass",
      },
    });
  });

  it("skips invalid eval outcomes by default and can publish them as zero", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: metric("quality"),
      outcome: EvalOutcome.invalid("bad data"),
    });

    expect(score).not.toHaveBeenCalled();

    await createReporter({ score }, { publishInvalid: true }).report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: metric("quality"),
      outcome: EvalOutcome.invalid("bad data"),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 0,
        comment: "bad data",
      }),
    );
  });

  it("does not crash eval suites for missing trace ids unless strict reporting is enabled", async () => {
    const score = vi.fn();
    const result = await runEvalSuite({
      name: "suite",
      cases: [{ id: "case-1", input: "input" }],
      target: async (input) => input,
      metrics: [metric("quality")],
      reporters: [createReporter({ score })],
    });

    expect(result.passed).toBe(1);
    expect(result.results[0]?.metrics[0]?.reporterErrors).toEqual([]);
    expect(score).not.toHaveBeenCalled();

    const strict = await runEvalSuite({
      name: "suite",
      cases: [{ id: "case-1", input: "input" }],
      target: async (input) => input,
      metrics: [metric("quality")],
      reporters: [createReporter({ score }, { strict: true })],
    });

    expect(strict.results[0]?.metrics[0]?.reporterErrors).toHaveLength(1);
  });

  it("uses trace ids from eval case metadata when output has no trace", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: {
        id: "case-1",
        input: "input",
        metadata: { traceId: "trace-1", observationId: "obs-1" },
      },
      output: "answer",
      metric: metric("numeric"),
      outcome: EvalOutcome.pass(0.7),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        observationId: "obs-1",
        name: "numeric",
        value: 0.7,
      }),
    );
  });
});

function fakeObservation(name: string, traceId: string, id: string) {
  const observation = {
    name,
    id,
    traceId,
    otelSpan: {
      setAttribute: vi.fn(),
    },
    startObservation: vi.fn(),
    update: vi.fn(),
    end: vi.fn(),
  };
  observation.update.mockReturnValue(observation);
  return observation;
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

function metric(name: string) {
  return {
    name,
    evaluate: () => EvalOutcome.pass(true),
  };
}
