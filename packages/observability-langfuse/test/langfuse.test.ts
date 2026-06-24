import { AssistantContent, type Message, type Usage } from "@anvia/core/completion";
import { EvalOutcome, runEvalSuite } from "@anvia/core/evals";
import type {
  AgentGenerationStartArgs,
  AgentRunObserver,
  AgentToolObserver,
} from "@anvia/core/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLangfuseEvalReporter as createReporter, langfuse } from "../src/index";

const mocks = vi.hoisted(() => ({
  forceFlush: vi.fn(),
  shutdown: vi.fn(),
  sdkStart: vi.fn(),
  processorConstructor: vi.fn(),
  sdkConstructor: vi.fn(),
  startObservation: vi.fn(),
  resourceFromAttributes: vi.fn((attributes: Record<string, unknown>) => ({
    __resource: true,
    attributes,
  })),
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

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attributes: Record<string, unknown>) =>
    mocks.resourceFromAttributes(attributes),
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  SEMRESATTRS_SERVICE_NAME: "service.name",
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

  it("resolves options from environment variables when not provided explicitly", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "env-public");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "env-secret");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://env.langfuse.test");
    vi.stubEnv("LANGFUSE_TRACING_ENVIRONMENT", "staging");
    vi.stubEnv("LANGFUSE_RELEASE", "env-release");

    langfuse.create();

    expect(mocks.processorConstructor).toHaveBeenCalledWith({
      baseUrl: "https://env.langfuse.test",
      publicKey: "env-public",
      secretKey: "env-secret",
      environment: "staging",
      release: "env-release",
    });
  });

  it("prefers explicit options over environment variables", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "env-public");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "env-secret");
    vi.stubEnv("LANGFUSE_TRACING_ENVIRONMENT", "staging");
    vi.stubEnv("LANGFUSE_RELEASE", "env-release");

    langfuse.create({
      publicKey: "option-public",
      secretKey: "option-secret",
      environment: "prod",
      release: "option-release",
    });

    expect(mocks.processorConstructor).toHaveBeenCalledWith({
      baseUrl: "https://cloud.langfuse.com",
      publicKey: "option-public",
      secretKey: "option-secret",
      environment: "prod",
      release: "option-release",
    });
  });

  it("treats empty string env values as missing", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");

    langfuse.create();

    const call = mocks.processorConstructor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("publicKey");
    expect(call).not.toHaveProperty("secretKey");
  });

  it("surfaces serviceName as a NodeSDK resource attribute when set via option", () => {
    langfuse.create({ serviceName: "support-agent" });

    expect(mocks.resourceFromAttributes).toHaveBeenCalledWith({
      "service.name": "support-agent",
    });
    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      spanProcessors: [expect.any(Object)],
      resource: expect.objectContaining({
        __resource: true,
        attributes: { "service.name": "support-agent" },
      }),
    });
  });

  it("surfaces serviceName as a NodeSDK resource attribute when set via env", () => {
    vi.stubEnv("LANGFUSE_SERVICE_NAME", "env-service");

    langfuse.create();

    expect(mocks.resourceFromAttributes).toHaveBeenCalledWith({
      "service.name": "env-service",
    });
    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      spanProcessors: [expect.any(Object)],
      resource: expect.objectContaining({
        __resource: true,
        attributes: { "service.name": "env-service" },
      }),
    });
  });

  it("does not construct a NodeSDK resource when serviceName is absent", () => {
    langfuse.create({ publicKey: "pk", secretKey: "sk" });

    const call = mocks.sdkConstructor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("resource");
    expect(mocks.resourceFromAttributes).not.toHaveBeenCalled();
  });

  it("includes serviceName in the root observation metadata", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ serviceName: "support-agent" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });

    expect(mocks.startObservation).toHaveBeenCalledWith(
      "support",
      expect.objectContaining({
        metadata: expect.objectContaining({ serviceName: "support-agent" }),
      }),
      { asType: "agent" },
    );
  });

  it("records providerRequest and modelInfo on the generation observation", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.startGeneration?.({
      turn: 1,
      request: {
        model: "gpt-4o",
        chatHistory: [userMessage("hi")],
        documents: [],
        tools: [],
        additionalParams: {},
      },
      providerRequest: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      modelInfo: {
        provider: "openai",
        defaultModel: "gpt-4o",
        capabilities: {
          streaming: true,
          tools: true,
          toolChoice: true,
          imageInput: false,
          documentInput: false,
          outputSchema: false,
          reasoning: false,
        },
      },
    });

    expect(turn.startObservation).toHaveBeenCalledWith(
      "model.turn.1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          providerRequest: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
          modelInfo: {
            provider: "openai",
            defaultModel: "gpt-4o",
            capabilities: {
              streaming: true,
              tools: true,
              toolChoice: true,
              imageInput: false,
              documentInput: false,
              outputSchema: false,
              reasoning: false,
            },
          },
        }),
      }),
      { asType: "generation" },
    );
  });

  it("records modelInfo without capabilities when omitted", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.startGeneration?.({
      turn: 1,
      request: {
        model: "gpt-4o",
        chatHistory: [userMessage("hi")],
        documents: [],
        tools: [],
        additionalParams: {},
      },
      modelInfo: { provider: "openai", defaultModel: "gpt-4o" },
    });

    const call = turn.startObservation.mock.calls[0]?.[1] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(call?.metadata?.modelInfo).toEqual({
      provider: "openai",
      defaultModel: "gpt-4o",
    });
    expect(call?.metadata?.modelInfo).not.toHaveProperty("capabilities");
  });

  it("does not record providerRequest or modelInfo when absent", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.startGeneration?.(generationStartArgs());

    const call = turn.startObservation.mock.calls[0]?.[1] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(call?.metadata).not.toHaveProperty("providerRequest");
    expect(call?.metadata).not.toHaveProperty("modelInfo");
  });

  it("records firstDeltaMs on generation end", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const generationObserver = await run.startGeneration?.(generationStartArgs());
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
    expect(generation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ firstDeltaMs: 12 }),
      }),
    );
  });

  it("omits firstDeltaMs from generation end when absent", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const generationObserver = await run.startGeneration?.(generationStartArgs());
    await generationObserver?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("Done")],
        usage: usage(2, 3),
        rawResponse: {},
      },
    });
    const call = generation.update.mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(call?.metadata).not.toHaveProperty("firstDeltaMs");
  });

  it("records toolDefinition and toolMetadata on tool start", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const tool = fakeObservation("tool", "trace-1", "obs-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(tool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.startTool?.({
      turn: 1,
      toolName: "get_ticket",
      args: '{"id":"TICKET-1"}',
      toolCall: AssistantContent.toolCall("call-1", "get_ticket", { id: "TICKET-1" }),
      internalCallId: "internal-1",
      toolCallId: "call-1",
      toolDefinition: {
        name: "get_ticket",
        description: "Fetch a support ticket",
        parameters: { type: "object", properties: { id: { type: "string" } } },
      },
      toolMetadata: { source: "cookbook" },
    });

    expect(turn.startObservation).toHaveBeenCalledWith(
      "tool.get_ticket",
      expect.objectContaining({
        metadata: expect.objectContaining({
          toolDefinition: {
            name: "get_ticket",
            description: "Fetch a support ticket",
            parameters: { type: "object", properties: { id: { type: "string" } } },
          },
          toolMetadata: { source: "cookbook" },
        }),
      }),
      { asType: "tool" },
    );
  });

  it("records structuredResult on tool end", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const tool = fakeObservation("tool", "trace-1", "obs-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(tool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const toolObserver = (await run.startTool?.({
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
      structuredResult: [{ type: "text", text: "TICKET-1" }],
      skipped: false,
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });
    expect(tool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          structuredResult: [{ type: "text", text: "TICKET-1" }],
        }),
      }),
    );
  });

  it("omits structuredResult from tool end when absent", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const tool = fakeObservation("tool", "trace-1", "obs-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(tool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const toolObserver = (await run.startTool?.({
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
    const call = tool.update.mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(call?.metadata).not.toHaveProperty("structuredResult");
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

  it("nests streamed child agent observations under the parent tool observation", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const parentTool = fakeObservation("parent-tool", "trace-1", "obs-parent-tool");
    const childAgent = fakeObservation("child-agent", "trace-1", "obs-child-agent");
    const childGeneration = fakeObservation("child-generation", "trace-1", "obs-child-generation");
    const childTool = fakeObservation("child-tool", "trace-1", "obs-child-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(parentTool);
    parentTool.startObservation.mockReturnValueOnce(childAgent);
    childAgent.startObservation.mockReturnValueOnce(childGeneration).mockReturnValueOnce(childTool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 2,
    })) as AgentRunObserver;
    const parentToolCall = AssistantContent.toolCall("call-child", "ask_child", {
      prompt: "inspect",
    });
    const tool = await run.startTool?.({
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
          messages: [],
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

    expect(parentTool.startObservation).toHaveBeenCalledWith(
      "Child_Agent.run",
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "agent_tool_event",
          childAgentId: "child",
          parentToolName: "ask_child",
        }),
      }),
      { asType: "agent" },
    );
    expect(childAgent.startObservation).toHaveBeenCalledWith(
      "Child_Agent.model.turn.1",
      expect.any(Object),
      { asType: "generation" },
    );
    expect(childAgent.startObservation).toHaveBeenCalledWith(
      "Child_Agent.add",
      expect.any(Object),
      { asType: "tool" },
    );
    expect(childTool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: "7",
        metadata: expect.objectContaining({ parentToolName: "ask_child" }),
      }),
    );
  });

  it("marks skipped tools as warnings", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const toolObservation = fakeObservation("tool", "trace-1", "obs-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(toolObservation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("skip"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const tool = await run.startTool?.({
      turn: 1,
      toolName: "get_ticket",
      args: "{}",
      toolCall: AssistantContent.toolCall("call-1", "get_ticket", {}),
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });

    await tool?.end({
      turn: 1,
      toolName: "get_ticket",
      args: "{}",
      toolCall: AssistantContent.toolCall("call-1", "get_ticket", {}),
      result: "",
      skipped: true,
      internalCallId: "internal-1",
      toolCallId: "call-1",
    });

    expect(toolObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "WARNING",
        statusMessage: "Tool call skipped by hook",
      }),
    );
  });

  it("records tool and streamed child agent errors", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const parentTool = fakeObservation("parent-tool", "trace-1", "obs-parent-tool");
    const childAgent = fakeObservation("child-agent", "trace-1", "obs-child-agent");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(parentTool);
    parentTool.startObservation.mockReturnValueOnce(childAgent);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const toolCall = AssistantContent.toolCall("call-child", "ask_child", {});
    const tool = await run.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        event: { type: "error", error: new Error("child failed") },
      },
    });
    await tool?.error?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      error: "tool failed",
    });

    expect(childAgent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "ERROR",
        statusMessage: "child failed",
        output: { error: "child failed" },
      }),
    );
    expect(parentTool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "ERROR",
        statusMessage: "tool failed",
        output: { error: "tool failed" },
      }),
    );
  });

  it("closes open streamed child observations when the parent tool ends", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const parentTool = fakeObservation("parent-tool", "trace-1", "obs-parent-tool");
    const childAgent = fakeObservation("child-agent", "trace-1", "obs-child-agent");
    const childGeneration = fakeObservation("child-generation", "trace-1", "obs-child-generation");
    const childTool = fakeObservation("child-tool", "trace-1", "obs-child-tool");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(parentTool);
    parentTool.startObservation.mockReturnValueOnce(childAgent);
    childAgent.startObservation.mockReturnValueOnce(childGeneration).mockReturnValueOnce(childTool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("delegate"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const toolCall = AssistantContent.toolCall("call-child", "ask_child", {});
    const tool = await run.startTool?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
        event: { type: "turn_start", turn: 1, prompt: userMessage("inspect"), history: [] },
      },
    });
    await tool?.streamEvent?.({
      turn: 1,
      toolName: "ask_child",
      args: "{}",
      toolCall,
      internalCallId: "internal-child",
      toolCallId: "call-child",
      event: {
        agentId: "child",
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
      toolCall,
      result: "done",
      skipped: false,
      internalCallId: "internal-child",
      toolCallId: "call-child",
    });

    expect(childGeneration.end).toHaveBeenCalledOnce();
    expect(childTool.end).toHaveBeenCalledOnce();
    expect(childAgent.end).toHaveBeenCalledOnce();
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

  it("maps additional eval score shapes and malformed trace outputs", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-object", input: "input" },
      output: { trace: { traceId: "trace-object" } },
      metric: metric("object"),
      outcome: EvalOutcome.pass({ score: 0.4 }),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-false", input: "input" },
      output: { trace: { traceId: "trace-false" } },
      metric: metric("boolean"),
      outcome: EvalOutcome.fail(false),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-fallback", input: "input" },
      output: { trace: { traceId: "trace-fallback" } },
      metric: metric("fallback"),
      outcome: EvalOutcome.pass(undefined),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-malformed", input: "input" },
      output: { trace: "not-a-trace" },
      metric: metric("malformed"),
      outcome: EvalOutcome.pass(true),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-missing-trace-id", input: "input" },
      output: { trace: { traceId: 123 } },
      metric: metric("missing"),
      outcome: EvalOutcome.pass(true),
    });

    expect(score).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ traceId: "trace-object", value: 0.4 }),
    );
    expect(score).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ traceId: "trace-false", value: 0 }),
    );
    expect(score).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ traceId: "trace-fallback", value: 1 }),
    );
    expect(score).toHaveBeenCalledTimes(3);
  });
});

describe("usageDetailsFromRecord", () => {
  it("includes cache token fields when present", async () => {
    const { usageDetailsFromRecord } = await import("../src/helpers");
    expect(
      usageDetailsFromRecord({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cachedInputTokens: 4,
        cacheCreationInputTokens: 5,
      }),
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cachedInputTokens: 4,
      cacheCreationInputTokens: 5,
    });
  });

  it("defaults cache token fields to 0 when absent", async () => {
    const { usageDetailsFromRecord } = await import("../src/helpers");
    expect(
      usageDetailsFromRecord({
        inputTokens: 1,
        outputTokens: 2,
      }),
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
  });

  it("defaults every field to 0 when given an empty record", async () => {
    const { usageDetailsFromRecord } = await import("../src/helpers");
    expect(usageDetailsFromRecord({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
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
