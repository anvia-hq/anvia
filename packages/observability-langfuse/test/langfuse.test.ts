import {
  AssistantContent,
  Message,
  type Message as MessageType,
  type Usage,
} from "@anvia/core/completion";
import { EvalOutcome, exactMatch, runEvalSuite } from "@anvia/core/evals";
import type {
  AgentGenerationStartArgs,
  AgentRunObserver,
  AgentToolObserver,
} from "@anvia/core/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLangfuseDatasetClient } from "../src/dataset-client";
import { runEvalAsExperiment } from "../src/experiment-runner";
import { createLangfuseEvalReporter as createReporter, langfuse } from "../src/index";
import { createLangfusePromptClient } from "../src/prompt-client";
import { ScoreQueue } from "../src/scoring";

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

  it("ignores legacy LANGFUSE_ENVIRONMENT in favor of LANGFUSE_TRACING_ENVIRONMENT", () => {
    vi.stubEnv("LANGFUSE_ENVIRONMENT", "legacy");

    langfuse.create();

    const call = mocks.processorConstructor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("environment");
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

  it("keeps message metadata on run transcripts but omits it from model inputs", async () => {
    const root = fakeObservation("root", "trace-1", "obs-root");
    const turn = fakeObservation("turn", "trace-1", "obs-turn");
    const generation = fakeObservation("generation", "trace-1", "obs-generation");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);
    const metadata = { composer: { entities: [{ id: "document-1" }] } };

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = (await tracing.startRun({
      prompt: Message.user("hello", { metadata }),
      history: [Message.user("earlier", { metadata })],
      maxTurns: 1,
    })) as AgentRunObserver;
    expect(mocks.startObservation).toHaveBeenCalledWith(
      "agent.run",
      expect.objectContaining({
        input: {
          prompt: expect.objectContaining({ metadata }),
          history: [expect.objectContaining({ metadata })],
        },
      }),
      { asType: "agent" },
    );

    await run.startGeneration?.({
      ...generationStartArgs(),
      request: {
        ...generationStartArgs().request,
        chatHistory: [Message.user("hello", { metadata })],
      },
    });
    const generationInput = turn.startObservation.mock.calls[0]?.[1]?.input as MessageType[];
    expect(generationInput[0]).not.toHaveProperty("metadata");

    await run.end({
      output: "done",
      usage: usage(1, 1),
      messages: [Message.assistant("done", { metadata })],
    });
    expect(root.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          messages: [expect.objectContaining({ metadata })],
        }),
      }),
    );
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

  it("forwards dataType through the score body", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });

    await tracing.score({
      traceId: "trace-1",
      name: "quality",
      value: 0.7,
      dataType: "NUMERIC",
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      dataType: "NUMERIC",
      value: 0.7,
    });

    vi.mocked(fetch).mockClear();
    await tracing.score({
      traceId: "trace-1",
      name: "verdict",
      value: "pass",
      dataType: "CATEGORICAL",
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      dataType: "CATEGORICAL",
      value: "pass",
    });
  });

  it("rejects CATEGORICAL with a non-string value", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await expect(
      tracing.score({
        traceId: "trace-1",
        name: "verdict",
        value: 1,
        dataType: "CATEGORICAL",
      }),
    ).rejects.toThrow(/CATEGORICAL/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts BOOLEAN scores with 0 or 1 and rejects other numbers", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });

    await tracing.score({ traceId: "trace-1", name: "is-correct", value: 0, dataType: "BOOLEAN" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      dataType: "BOOLEAN",
      value: 0,
    });

    vi.mocked(fetch).mockClear();
    await tracing.score({ traceId: "trace-1", name: "is-correct", value: 1, dataType: "BOOLEAN" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      dataType: "BOOLEAN",
      value: 1,
    });

    await expect(
      tracing.score({ traceId: "trace-1", name: "is-correct", value: 2, dataType: "BOOLEAN" }),
    ).rejects.toThrow(/BOOLEAN/);
  });

  it("rejects NUMERIC with a non-number value", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await expect(
      tracing.score({
        traceId: "trace-1",
        name: "quality",
        value: "0.5",
        dataType: "NUMERIC",
      }),
    ).rejects.toThrow(/NUMERIC/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends configId and accepts scoreConfigId as an alias", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });

    await tracing.score({ traceId: "trace-1", name: "quality", value: 1, configId: "cfg-1" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      configId: "cfg-1",
    });

    vi.mocked(fetch).mockClear();
    await tracing.score({ traceId: "trace-1", name: "quality", value: 1, scoreConfigId: "cfg-2" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      configId: "cfg-2",
    });
  });

  it("prefers configId over scoreConfigId when both are set", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.score({
      traceId: "trace-1",
      name: "quality",
      value: 1,
      configId: "canonical",
      scoreConfigId: "alias",
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.configId).toBe("canonical");
    expect(body).not.toHaveProperty("scoreConfigId");
  });

  it("forwards environment and timestamp overrides in the score body", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.score({
      traceId: "trace-1",
      name: "quality",
      value: 1,
      environment: "staging",
      timestamp: "2026-06-24T00:00:00Z",
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      environment: "staging",
      timestamp: "2026-06-24T00:00:00Z",
    });
  });

  it("normalizes a Date timestamp to ISO 8601", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.score({
      traceId: "trace-1",
      name: "quality",
      value: 1,
      timestamp: new Date("2026-06-24T00:00:00Z"),
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.timestamp).toBe("2026-06-24T00:00:00.000Z");
  });

  it("applies a default 30s timeout and respects timeoutMs", async () => {
    const fetchMock = vi.mocked(fetch);

    const defaultTracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await defaultTracing.score({ traceId: "trace-1", name: "quality", value: 1 });
    const defaultSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal as
      | AbortSignal
      | undefined;
    expect(defaultSignal).toBeInstanceOf(AbortSignal);
    expect(defaultSignal?.aborted).toBe(false);

    vi.mocked(fetch).mockClear();
    const slowTracing = langfuse.create({ publicKey: "pk", secretKey: "sk", timeoutMs: 50 });
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
          if (signal === undefined) {
            reject(new Error("missing signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(
      slowTracing.score({ traceId: "trace-1", name: "quality", value: 1 }),
    ).rejects.toBeInstanceOf(DOMException);
  });

  it("does not read the response body on 2xx", async () => {
    const textSpy = vi.fn(async () => "unused");
    const response = new Response(null, { status: 204 });
    Object.defineProperty(response, "text", { value: textSpy });
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(response));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.score({ traceId: "trace-1", name: "quality", value: 1 });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("includes the error response text in the rejection message", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response("oops", { status: 500 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await expect(tracing.score({ traceId: "trace-1", name: "quality", value: 1 })).rejects.toThrow(
      /oops/,
    );
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
        caseInputSummary: "input",
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

  it("forwards metric.metadata, dataType, and configId to the score body", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: {
        name: "quality",
        dataType: "CATEGORICAL",
        configId: "sc-1",
        scoreConfigId: "sc-1-alt",
        metadata: { suite: "qa", tags: ["smoke"] },
        evaluate: () => EvalOutcome.pass("good"),
      },
      outcome: EvalOutcome.pass("good"),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        name: "quality",
        value: "good",
        dataType: "CATEGORICAL",
        configId: "sc-1",
        metadata: expect.objectContaining({
          suite: "qa",
          tags: ["smoke"],
          caseInputSummary: "input",
        }),
      }),
    );
  });

  it("prefers metric.configId over scoreConfigId when both are set", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: {
        name: "quality",
        configId: "config-wins",
        scoreConfigId: "config-loses",
        evaluate: () => EvalOutcome.pass(true),
      },
      outcome: EvalOutcome.pass(true),
    });

    expect(score).toHaveBeenCalledWith(expect.objectContaining({ configId: "config-wins" }));
  });

  it("sends categorical outcome scores as strings with dataType", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: { name: "quality", dataType: "CATEGORICAL", evaluate: () => EvalOutcome.pass("ok") },
      outcome: EvalOutcome.pass("ok"),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-2", input: "input" },
      output: { trace: { traceId: "trace-2" } },
      metric: { name: "quality", dataType: "CATEGORICAL", evaluate: () => EvalOutcome.fail(true) },
      outcome: EvalOutcome.fail(true),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-3", input: "input" },
      output: { trace: { traceId: "trace-3" } },
      metric: {
        name: "quality",
        dataType: "CATEGORICAL",
        evaluate: () => EvalOutcome.pass(undefined),
      },
      outcome: EvalOutcome.pass(undefined),
    });

    expect(score).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ value: "ok", dataType: "CATEGORICAL" }),
    );
    expect(score).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ value: "true", dataType: "CATEGORICAL" }),
    );
    expect(score).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ value: "pass", dataType: "CATEGORICAL" }),
    );
  });

  it("sends boolean outcomes as 0/1 when dataType is BOOLEAN", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: { name: "boolean", dataType: "BOOLEAN", evaluate: () => EvalOutcome.pass(true) },
      outcome: EvalOutcome.pass(true),
    });
    await reporter.report({
      suiteName: "suite",
      case: { id: "case-2", input: "input" },
      output: { trace: { traceId: "trace-2" } },
      metric: { name: "boolean", dataType: "BOOLEAN", evaluate: () => EvalOutcome.pass(undefined) },
      outcome: EvalOutcome.pass(undefined),
    });

    expect(score).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ value: 1, dataType: "BOOLEAN" }),
    );
    expect(score).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ value: 1, dataType: "BOOLEAN" }),
    );
  });

  it("includes truncated case input and expected summaries", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score }, { truncateInputAt: 32 });

    const bigInput = "a".repeat(200);
    const bigExpected = { note: "b".repeat(200) };

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: bigInput, expected: bigExpected },
      output: { trace: { traceId: "trace-1" } },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true),
    });

    const call = score.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> };
    expect(call.metadata?.caseInputSummary).toMatch(/^a+<truncated>$/);
    expect(call.metadata?.caseExpectedSummary).toMatch(/<truncated>$/);
  });

  it("includes output.messages when includeMessages is not set", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: {
        trace: { traceId: "trace-1" },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      }),
    );
  });

  it("omits output.messages when includeMessages is false", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score }, { includeMessages: false });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: {
        trace: { traceId: "trace-1" },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true),
    });

    const call = score.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> };
    expect(call.metadata).not.toHaveProperty("messages");
  });

  it("falls back to args.case.input.trace when output.trace is missing", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: {
        id: "case-1",
        input: { trace: { traceId: "trace-from-input", observationId: "obs-from-input" } },
      },
      output: { output: "answer" },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-from-input",
        observationId: "obs-from-input",
      }),
    );
  });

  it("ignores malformed args.case.input.trace without throwing", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: {
        id: "case-1",
        input: { trace: "not-an-object" },
      },
      output: { output: "answer" },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true),
    });

    expect(score).not.toHaveBeenCalled();
  });

  it("onMissingTrace 'throw' raises when no trace can be found", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score }, { onMissingTrace: "throw" });

    await expect(
      reporter.report({
        suiteName: "suite",
        case: { id: "case-1", input: "input" },
        output: "answer",
        metric: metric("quality"),
        outcome: EvalOutcome.pass(true),
      }),
    ).rejects.toThrow(/traceId/);
  });

  it("onMissingTrace 'warn' logs a console warning but does not throw", async () => {
    const score = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reporter = createReporter({ score }, { onMissingTrace: "warn" });

    await expect(
      reporter.report({
        suiteName: "suite",
        case: { id: "case-1", input: "input" },
        output: "answer",
        metric: metric("quality"),
        outcome: EvalOutcome.pass(true),
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(score).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("onMissingTrace 'ignore' returns silently when no trace can be found", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score }, { onMissingTrace: "ignore" });

    await expect(
      reporter.report({
        suiteName: "suite",
        case: { id: "case-1", input: "input" },
        output: "answer",
        metric: metric("quality"),
        outcome: EvalOutcome.pass(true),
      }),
    ).resolves.toBeUndefined();
    expect(score).not.toHaveBeenCalled();
  });

  it("strict: true continues to work as an alias for onMissingTrace 'throw'", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score }, { strict: true });

    await expect(
      reporter.report({
        suiteName: "suite",
        case: { id: "case-1", input: "input" },
        output: "answer",
        metric: metric("quality"),
        outcome: EvalOutcome.pass(true),
      }),
    ).rejects.toThrow(/traceId/);
  });

  it("forwards args.outcome.metadata into the score metadata", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    await reporter.report({
      suiteName: "suite",
      case: { id: "case-1", input: "input" },
      output: { trace: { traceId: "trace-1" } },
      metric: metric("quality"),
      outcome: EvalOutcome.pass(true, {
        metadata: { judge: "llm-judge-1", rationale: "looks good" },
      }),
    });

    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          judge: "llm-judge-1",
          rationale: "looks good",
        }),
      }),
    );
  });

  it("does not mutate metric.metadata or case.metadata", async () => {
    const score = vi.fn();
    const reporter = createReporter({ score });

    const metricMeta = { suite: "qa" };
    const caseMeta = { traceId: "trace-1" };
    const metric = {
      name: "quality",
      metadata: metricMeta,
      evaluate: () => EvalOutcome.pass(true, { metadata: { reason: "looks good" } }),
    };
    const testCase = { id: "case-1", input: "input", metadata: caseMeta };

    await reporter.report({
      suiteName: "suite",
      case: testCase,
      output: "answer",
      metric,
      outcome: EvalOutcome.pass(true, { metadata: { reason: "looks good" } }),
    });

    expect(metricMeta).toEqual({ suite: "qa" });
    expect(caseMeta).toEqual({ traceId: "trace-1" });
  });
});

describe("LangfuseGenerationObserver.update", () => {
  it("forwards text deltas to generation.update with output.delta", async () => {
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
    generationObserver?.update?.({ turn: 1, delta: { type: "text_delta", delta: "hi" } });
    expect(generation.update).toHaveBeenCalledWith({
      output: { delta: { type: "text_delta", delta: "hi" } },
    });
  });

  it("forwards reasoning deltas with id and signature", async () => {
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
    generationObserver?.update?.({
      turn: 1,
      delta: { type: "reasoning_delta", delta: "thinking...", id: "r1", signature: "sig" },
    });
    expect(generation.update).toHaveBeenCalledWith({
      output: {
        delta: { type: "reasoning_delta", delta: "thinking...", id: "r1", signature: "sig" },
      },
    });
  });

  it("forwards tool_call deltas with the toolCall payload", async () => {
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
    const toolCall = AssistantContent.toolCall("call-1", "search", { q: "x" });
    generationObserver?.update?.({ turn: 1, delta: { type: "tool_call", toolCall } });
    expect(generation.update).toHaveBeenCalledWith({
      output: { delta: { type: "tool_call", toolCall } },
    });
  });

  it("preserves the final end output after streaming deltas", async () => {
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
    generationObserver?.update?.({ turn: 1, delta: { type: "text_delta", delta: "he" } });
    generationObserver?.update?.({ turn: 1, delta: { type: "text_delta", delta: "llo" } });
    generationObserver?.end({
      turn: 1,
      response: {
        messageId: "msg-1",
        choice: [AssistantContent.text("hello")],
        usage: usage(2, 3),
        rawResponse: {},
      },
    });
    expect(generation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ text: "hello" }),
      }),
    );
    expect(generation.end).toHaveBeenCalledOnce();
  });
});

describe("ScoreQueue", () => {
  type QueueHandle = {
    queue: ScoreQueue;
    fetchMock: ReturnType<typeof vi.fn>;
    sleepMock: ReturnType<typeof vi.fn>;
  };

  function makeQueue(
    overrides: Partial<{
      fetchImpl: typeof fetch;
      sleep: (ms: number) => Promise<void>;
      setTimer: (handler: () => void, ms: number) => unknown;
      clearTimer: (handle: unknown) => void;
      flushIntervalMs: number;
      batchSize: number;
      maxRetries: number;
    }> = {},
  ): QueueHandle {
    const fetchMock = (overrides.fetchImpl ??
      vi.fn(async () => new Response(null, { status: 204 }))) as
      | typeof fetch
      | ReturnType<typeof vi.fn>;
    const sleepMock = (overrides.sleep ?? vi.fn(async () => {})) as
      | ((ms: number) => Promise<void>)
      | ReturnType<typeof vi.fn>;
    const options: ConstructorParameters<typeof ScoreQueue>[0] = {
      baseUrl: "https://langfuse.test",
      publicKey: "pk",
      secretKey: "sk",
      timeoutMs: 5_000,
      batchSize: overrides.batchSize ?? 3,
      flushIntervalMs: overrides.flushIntervalMs ?? 100,
      maxRetries: overrides.maxRetries ?? 3,
      fetchImpl: fetchMock as typeof fetch,
      sleep: sleepMock as (ms: number) => Promise<void>,
    };
    if (overrides.setTimer) options.setTimer = overrides.setTimer;
    if (overrides.clearTimer) options.clearTimer = overrides.clearTimer;
    const queue = new ScoreQueue(options);
    return {
      queue,
      fetchMock: fetchMock as ReturnType<typeof vi.fn>,
      sleepMock: sleepMock as ReturnType<typeof vi.fn>,
    };
  }

  function scoreArgs(overrides: Partial<{ traceId: string; name: string; value: number }> = {}) {
    return {
      traceId: "trace-1",
      name: "quality",
      value: 1,
      ...overrides,
    };
  }

  it("enqueue keeps depth accurate", () => {
    const { queue } = makeQueue();
    expect(queue.depth()).toBe(0);
    queue.enqueue(scoreArgs());
    queue.enqueue(scoreArgs({ name: "latency" }));
    expect(queue.depth()).toBe(2);
  });

  it("flush posts a JSON array with all pending scores", async () => {
    const { queue, fetchMock } = makeQueue();
    queue.enqueue(scoreArgs());
    queue.enqueue(scoreArgs({ name: "latency", value: 0.5 }));

    await queue.flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ traceId: "trace-1", name: "quality", value: 1 });
    expect(body[1]).toMatchObject({ name: "latency", value: 0.5 });
    expect(queue.depth()).toBe(0);
  });

  it("flush returns when the response is 2xx and clears the queue", async () => {
    const { queue, fetchMock } = makeQueue();
    queue.enqueue(scoreArgs());
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(queue.depth()).toBe(0);
  });

  it("retries on 429 with exponential backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sleepMock = vi.fn(async () => {});
    const { queue } = makeQueue({
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep: sleepMock,
    });

    queue.enqueue(scoreArgs());
    await queue.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    const sleepCalls = sleepMock.mock.calls as unknown as Array<[number]>;
    const first = sleepCalls[0]?.[0] ?? 0;
    const second = sleepCalls[1]?.[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("retries on 500 with exponential backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sleepMock = vi.fn(async () => {});
    const { queue } = makeQueue({
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep: sleepMock,
    });

    queue.enqueue(scoreArgs());
    await queue.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledOnce();
  });

  it("does not retry on 400 and throws LangfuseScoreError with scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const { queue } = makeQueue({ fetchImpl: fetchMock as unknown as typeof fetch });
    const scores = [scoreArgs(), scoreArgs({ name: "latency" })];

    for (const s of scores) queue.enqueue(s);

    await expect(queue.flush()).rejects.toMatchObject({
      name: "LangfuseScoreError",
      message: expect.stringMatching(/HTTP 400/),
      scores: expect.arrayContaining([
        expect.objectContaining({ name: "quality" }),
        expect.objectContaining({ name: "latency" }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("gives up after maxRetries and throws LangfuseScoreError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const sleepMock = vi.fn(async () => {});
    const { queue } = makeQueue({
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleep: sleepMock,
      maxRetries: 3,
    });

    queue.enqueue(scoreArgs());
    await expect(queue.flush()).rejects.toMatchObject({
      name: "LangfuseScoreError",
      message: expect.stringMatching(/after 3 attempts/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("size threshold triggers an immediate flush without waiting for the timer", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const { queue } = makeQueue({ fetchImpl: fetchMock as unknown as typeof fetch, batchSize: 2 });

    queue.enqueue(scoreArgs());
    queue.enqueue(scoreArgs({ name: "latency" }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(queue.depth()).toBe(0);
  });

  it("shutdown flushes pending scores and clears the timer", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const { queue } = makeQueue({ fetchImpl: fetchMock as unknown as typeof fetch });

    queue.enqueue(scoreArgs());
    await queue.shutdown();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(queue.depth()).toBe(0);
  });
});

describe("score queue integration", () => {
  it("score() direct-sends when scoreBatchSize is not set", async () => {
    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    expect(tracing.scoreQueueDepth()).toBe(0);

    await tracing.score({ traceId: "t", name: "n", value: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(tracing.scoreQueueDepth()).toBe(0);
  });

  it("score() enqueues when scoreBatchSize is set and exposes depth", async () => {
    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      scoreBatchSize: 10,
    });
    expect(tracing.scoreQueueDepth()).toBe(0);

    await tracing.score({ traceId: "t", name: "n", value: 1 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(tracing.scoreQueueDepth()).toBe(1);
  });

  it("flushScores() drains the queue and posts one batched request", async () => {
    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      scoreBatchSize: 10,
    });
    await tracing.score({ traceId: "t1", name: "quality", value: 1 });
    await tracing.score({ traceId: "t2", name: "latency", value: 0.4 });
    expect(tracing.scoreQueueDepth()).toBe(2);

    await tracing.flushScores();
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toHaveLength(2);
    expect(tracing.scoreQueueDepth()).toBe(0);
  });

  it("flush() also drains the score queue in addition to processor.forceFlush()", async () => {
    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      scoreBatchSize: 10,
    });
    await tracing.score({ traceId: "t1", name: "quality", value: 1 });
    expect(tracing.scoreQueueDepth()).toBe(1);

    await tracing.flush();
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(tracing.scoreQueueDepth()).toBe(0);
    expect(mocks.forceFlush).toHaveBeenCalledOnce();
  });

  it("shutdown() drains the score queue and stops the SDK", async () => {
    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      scoreBatchSize: 10,
    });
    await tracing.score({ traceId: "t1", name: "quality", value: 1 });

    await tracing.shutdown();
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(tracing.scoreQueueDepth()).toBe(0);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it("LangfuseScoreError carries the failed scores when a batch fails non-retryably", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response("bad", { status: 400 })));

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      scoreBatchSize: 10,
    });
    await tracing.score({ traceId: "t1", name: "quality", value: 1 });
    await tracing.score({ traceId: "t2", name: "latency", value: 0.4 });

    await expect(tracing.flushScores()).rejects.toMatchObject({
      name: "LangfuseScoreError",
      scores: expect.arrayContaining([
        expect.objectContaining({ traceId: "t1" }),
        expect.objectContaining({ traceId: "t2" }),
      ]),
    });
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

describe("LangfuseTraceHandle", () => {
  it("getCurrentTrace() returns undefined before any run", () => {
    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    expect(tracing.getCurrentTrace()).toBeUndefined();
  });

  it("getCurrentTrace() returns a handle during a run and clears it after end", async () => {
    const root = fakeObservation("root", "trace-7", "obs-root-7");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const runObserver = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const handle = tracing.getCurrentTrace();
    expect(handle).toBeDefined();
    expect(handle?.traceId).toBe("trace-7");
    expect(handle?.observationId).toBe("obs-root-7");
    expect(handle?.traceId).toBe(runObserver.trace?.traceId);
    expect(handle?.observationId).toBe(runObserver.trace?.observationId);

    await runObserver.end({
      output: "Done",
      usage: usage(1, 2),
      messages: [],
    });
    expect(tracing.getCurrentTrace()).toBeUndefined();
  });

  it("getCurrentTrace() returns undefined after a run errors", async () => {
    const root = fakeObservation("root", "trace-8", "obs-root-8");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const runObserver = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    expect(tracing.getCurrentTrace()).toBeDefined();

    await runObserver.error?.({
      error: new Error("boom"),
      usage: usage(0, 0),
      messages: [],
    });
    expect(tracing.getCurrentTrace()).toBeUndefined();
  });

  it("addAttributes updates the root observation metadata", async () => {
    const root = fakeObservation("root", "trace-9", "obs-root-9");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });

    tracing.getCurrentTrace()?.addAttributes({ quality: "high", score: 0.9 });
    expect(root.update).toHaveBeenCalledWith({ metadata: { quality: "high", score: 0.9 } });
  });

  it("addEvent creates an event observation under the root and ends it", async () => {
    const root = fakeObservation("root", "trace-10", "obs-root-10");
    const event = fakeObservation("event", "trace-10", "obs-event-1");
    root.startObservation.mockReturnValueOnce(event);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });

    tracing.getCurrentTrace()?.addEvent("retrieval.done", { docCount: 4 });
    expect(root.startObservation).toHaveBeenCalledWith(
      "retrieval.done",
      { metadata: { docCount: 4 } },
      { asType: "event" },
    );
    expect(event.end).toHaveBeenCalledOnce();
  });

  it("event? on the run observer creates an event observation", async () => {
    const root = fakeObservation("root", "trace-11", "obs-root-11");
    const event = fakeObservation("event", "trace-11", "obs-event-2");
    root.startObservation.mockReturnValueOnce(event);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const runObserver = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await runObserver.event?.({
      name: "validation.passed",
      attributes: { checks: 3 },
    });

    expect(root.startObservation).toHaveBeenCalledWith(
      "validation.passed",
      { metadata: { checks: 3 } },
      { asType: "event" },
    );
    expect(event.end).toHaveBeenCalledOnce();
  });

  it("multiple addEvent calls within one run all create observations", async () => {
    const root = fakeObservation("root", "trace-12", "obs-root-12");
    const eventA = fakeObservation("eventA", "trace-12", "obs-event-A");
    const eventB = fakeObservation("eventB", "trace-12", "obs-event-B");
    root.startObservation.mockReturnValueOnce(eventA).mockReturnValueOnce(eventB);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });

    const handle = tracing.getCurrentTrace();
    handle?.addEvent("retrieval.done");
    handle?.addEvent("validation.passed");

    expect(root.startObservation).toHaveBeenCalledTimes(2);
    expect(root.startObservation).toHaveBeenNthCalledWith(
      1,
      "retrieval.done",
      { metadata: {} },
      { asType: "event" },
    );
    expect(root.startObservation).toHaveBeenNthCalledWith(
      2,
      "validation.passed",
      { metadata: {} },
      { asType: "event" },
    );
    expect(eventA.end).toHaveBeenCalledOnce();
    expect(eventB.end).toHaveBeenCalledOnce();
  });

  it("sequential runs replace the handle (last-write-wins)", async () => {
    const rootA = fakeObservation("rootA", "trace-A", "obs-root-A");
    const rootB = fakeObservation("rootB", "trace-B", "obs-root-B");
    rootA.startObservation.mockReturnValue(rootA);
    rootB.startObservation.mockReturnValue(rootB);
    mocks.startObservation.mockReturnValueOnce(rootA).mockReturnValueOnce(rootB);

    const tracing = langfuse.create({ publicKey: "public", secretKey: "secret" });
    const runA = (await tracing.startRun({
      agentName: "agent-a",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const handleA = tracing.getCurrentTrace();
    expect(handleA?.traceId).toBe("trace-A");

    await runA.end({
      output: "Done A",
      usage: usage(1, 1),
      messages: [],
    });

    const runB = (await tracing.startRun({
      agentName: "agent-b",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const handleB = tracing.getCurrentTrace();
    expect(handleB?.traceId).toBe("trace-B");
    expect(handleB).not.toBe(handleA);

    await runB.end({
      output: "Done B",
      usage: usage(1, 1),
      messages: [],
    });
    expect(tracing.getCurrentTrace()).toBeUndefined();
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

function userMessage(text: string): MessageType {
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

describe("LangfuseDatasetClient", () => {
  function readJsonBody(body: unknown): unknown {
    if (typeof body !== "string") return body;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  function makeFetchResponse(body: unknown, status = 200): Response {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    });
  }

  function basicAuthHeader(publicKey: string, secretKey: string): string {
    const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
    return `Basic ${encoded}`;
  }

  it("createDataset PUTs to /api/public/datasets/:name with auth", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse({ id: 1 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const dataset = await client.createDataset({
      name: "support-set",
      description: "smoke",
      metadata: { owner: "team" },
    });

    expect(dataset.name).toBe("support-set");
    expect(dataset.description).toBe("smoke");
    expect(dataset.metadata).toEqual({ owner: "team" });
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/public/datasets/support-set");
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuthHeader("pk", "sk"));
    expect(readJsonBody(init.body)).toEqual({
      name: "support-set",
      description: "smoke",
      metadata: { owner: "team" },
    });
  });

  it("reuses credentials and baseUrl from a langfuse tracing instance", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse({ id: 1 })));

    const tracing = langfuse.create({
      publicKey: "trace-pk",
      secretKey: "trace-sk",
      baseUrl: "https://trace.langfuse.test",
    });
    const client = createDatasetClient(tracing);
    await client.createDataset({ name: "support-set" });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://trace.langfuse.test/api/public/datasets/support-set");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuthHeader("trace-pk", "trace-sk"));
  });

  it("prefers explicit dataset client options over tracing config", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse({ id: 1 })));

    const tracing = langfuse.create({
      publicKey: "trace-pk",
      secretKey: "trace-sk",
      baseUrl: "https://trace.langfuse.test",
    });
    const client = createDatasetClient(tracing, {
      publicKey: "option-pk",
      secretKey: "option-sk",
      baseUrl: "https://option.langfuse.test",
    });
    await client.createDataset({ name: "support-set" });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://option.langfuse.test/api/public/datasets/support-set");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuthHeader("option-pk", "option-sk"));
  });

  it("falls back to env vars when given a custom tracing-like object", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "env-pk");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "env-sk");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://env.langfuse.test");
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse({ id: 1 })));

    const client = createLangfuseDatasetClient({ score: async () => undefined });
    await client.createDataset({ name: "support-set" });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://env.langfuse.test/api/public/datasets/support-set");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuthHeader("env-pk", "env-sk"));
  });

  it("getDataset GETs the dataset and returns items", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makeFetchResponse({
          name: "support-set",
          description: "smoke",
          metadata: { owner: "team" },
          items: [
            { id: "i-1", input: { q: "hi" }, expected: "hello" },
            { id: "i-2", input: { q: "bye" } },
          ],
          meta: { totalPages: 1 },
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const dataset = await client.getDataset<{ q: string }, string>("support-set");

    expect(dataset.name).toBe("support-set");
    expect(dataset.description).toBe("smoke");
    expect(dataset.metadata).toEqual({ owner: "team" });
    expect(dataset.items).toHaveLength(2);
    expect(dataset.items[0]?.id).toBe("i-1");
    expect(dataset.items[0]?.input).toEqual({ q: "hi" });
    expect(dataset.items[0]?.expected).toBe("hello");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/public/datasets/support-set?page=1&limit=50");
    expect(init.method).toBe("GET");
  });

  it("getDataset paginates until exhausted", async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(
        Promise.resolve(
          makeFetchResponse({
            name: "support-set",
            items: [{ id: "i-1", input: "a" }],
            meta: { totalPages: 2 },
          }),
        ),
      )
      .mockReturnValueOnce(
        Promise.resolve(
          makeFetchResponse({
            name: "support-set",
            items: [{ id: "i-2", input: "b" }],
            meta: { totalPages: 2 },
          }),
        ),
      );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
      pageSize: 1,
    });
    const dataset = await client.getDataset<string, string>("support-set");

    expect(dataset.items).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(secondCall[0]).toContain("page=2");
  });

  it("upsertItems POSTs the items array", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    await client.upsertItems("support-set", [
      { id: "i-1", input: { q: "hi" }, expected: "hello" },
      { id: "i-2", input: { q: "bye" } },
    ]);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/public/datasets/support-set/items");
    expect(init.method).toBe("POST");
    expect(readJsonBody(init.body)).toEqual({
      items: [
        { id: "i-1", input: { q: "hi" }, expected: "hello" },
        { id: "i-2", input: { q: "bye" } },
      ],
    });
  });

  it("upsertItems throws on non-2xx with the response body", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse("bad request", 400)));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });

    await expect(client.upsertItems("support-set", [{ id: "i-1", input: "x" }])).rejects.toThrow(
      /bad request/,
    );
  });

  it("runExperiment accepts local items and POSTs one batched run", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const result = await client.runExperiment({
      datasetName: "support-set",
      runName: "run-1",
      items: [
        { id: "i-1", input: { q: "hi" }, expected: "hello" },
        { id: "i-2", input: { q: "bye" } },
      ],
      run: (item) => ({
        output: `out-${item.id}`,
        trace: { traceId: `trace-${item.id}`, observationId: `obs-${item.id}` },
      }),
    });

    expect(result).toEqual({
      runName: "run-1",
      datasetName: "support-set",
      posted: 2,
      errors: [],
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/public/dataset-run-items");
    expect(init.method).toBe("POST");
    expect(readJsonBody(init.body)).toEqual({
      runName: "run-1",
      datasetItemRuns: [
        {
          datasetItemId: "i-1",
          traceId: "trace-i-1",
          observationId: "obs-i-1",
          output: "out-i-1",
        },
        {
          datasetItemId: "i-2",
          traceId: "trace-i-2",
          observationId: "obs-i-2",
          output: "out-i-2",
        },
      ],
    });
  });

  it("runExperiment pulls items from a remote dataset when items are not provided", async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(
        Promise.resolve(
          makeFetchResponse({
            name: "remote-set",
            items: [
              { id: "i-1", input: "a" },
              { id: "i-2", input: "b" },
            ],
            meta: { totalPages: 1 },
          }),
        ),
      )
      .mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const result = await client.runExperiment({
      datasetName: "remote-set",
      runName: "run-2",
      run: (item) => ({ output: `out-${item.id}`, trace: undefined }),
    });

    expect(result.posted).toBe(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const [getUrl] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(getUrl).toContain("/api/public/datasets/remote-set?");
    const [postUrl] = vi.mocked(fetch).mock.calls[1] as [string];
    expect(postUrl).toContain("/api/public/dataset-run-items");
  });

  it("runExperiment continues on per-item errors", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const result = await client.runExperiment({
      datasetName: "support-set",
      runName: "run-3",
      items: [
        { id: "i-1", input: "a" },
        { id: "i-2", input: "b" },
        { id: "i-3", input: "c" },
      ],
      run: (item) => {
        if (item.id === "i-2") throw new Error("kaboom");
        return { output: `out-${item.id}`, trace: undefined };
      },
    });

    expect(result.posted).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.itemId).toBe("i-2");
    expect((result.errors[0]?.error as Error).message).toBe("kaboom");
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = readJsonBody(init.body) as { datasetItemRuns: unknown[] };
    expect(body.datasetItemRuns).toHaveLength(2);
  });

  it("runExperiment throws on non-2xx POST", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(makeFetchResponse("server error", 500)));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });

    await expect(
      client.runExperiment({
        datasetName: "support-set",
        runName: "run-4",
        items: [{ id: "i-1", input: "a" }],
        run: (item) => ({ output: `out-${item.id}`, trace: undefined }),
      }),
    ).rejects.toThrow(/server error/);
  });

  it("runExperiment returns empty posted count when dataset has no items", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(makeFetchResponse({ name: "empty-set", items: [], meta: { totalPages: 1 } })),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const result = await client.runExperiment({
      datasetName: "empty-set",
      runName: "run-5",
      run: (item) => ({ output: `out-${item.id}`, trace: undefined }),
    });

    expect(result).toEqual({
      runName: "run-5",
      datasetName: "empty-set",
      posted: 0,
      errors: [],
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("runEvalAsExperiment", () => {
  it("runs the eval suite and posts a dataset run with per-case outputs and traces", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const { suite, datasetRun } = await runEvalAsExperiment(
      {
        name: "smoke",
        cases: [
          { id: "c-1", input: "a", expected: "A" },
          { id: "c-2", input: "b", expected: "B" },
        ],
        target: async (input) =>
          ({ output: input.toUpperCase(), trace: { traceId: `trace-${input}` } }) as never,
        metrics: [exactMatch()],
        reporters: [],
      },
      {
        tracing,
        client,
        datasetName: "smoke-set",
        runName: "smoke-run",
      },
    );

    expect(suite.passed).toBe(2);
    expect(datasetRun.posted).toBe(2);
    expect(datasetRun.errors).toEqual([]);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      runName: string;
      datasetItemRuns: Array<{
        datasetItemId: string;
        traceId?: string;
        output: unknown;
      }>;
    };
    expect(body.runName).toBe("smoke-run");
    expect(body.datasetItemRuns).toHaveLength(2);
    expect(body.datasetItemRuns[0]?.datasetItemId).toBe("c-1");
    expect(body.datasetItemRuns[0]?.traceId).toBe("trace-a");
    expect(body.datasetItemRuns[1]?.datasetItemId).toBe("c-2");
    expect(body.datasetItemRuns[1]?.traceId).toBe("trace-b");
  });

  it("wires the metric reporter and the dataset run separately", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve(new Response(null, { status: 204 })));

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const reporter = createReporter(tracing);
    const client = createDatasetClient(tracing, {
      publicKey: "pk",
      secretKey: "sk",
    });
    const { suite } = await runEvalAsExperiment(
      {
        name: "smoke",
        cases: [{ id: "c-1", input: "a", expected: "a" }],
        target: async (input) => input,
        metrics: [exactMatch()],
        reporters: [reporter],
      },
      {
        tracing,
        client,
        datasetName: "smoke-set",
        runName: "smoke-run",
      },
    );

    expect(suite.passed).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

function createDatasetClient(
  tracing: ReturnType<typeof langfuse.create>,
  options: Parameters<typeof createLangfuseDatasetClient>[1] = {},
): ReturnType<typeof createLangfuseDatasetClient> {
  return createLangfuseDatasetClient(tracing, options);
}

describe("LangfusePromptClient", () => {
  function makePromptJson(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function basicAuth(publicKey: string, secretKey: string): string {
    const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
    return `Basic ${encoded}`;
  }

  it("getPrompt GETs /api/public/v2/prompts/:name with auth", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 3,
          labels: ["production"],
          prompt: "You are a support agent.",
          type: "text",
          tags: ["qa"],
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    const prompt = await client.getPrompt("support.system");

    expect(prompt.name).toBe("support.system");
    expect(prompt.version).toBe(3);
    expect(prompt.labels).toEqual(["production"]);
    expect(prompt.prompt).toBe("You are a support agent.");
    expect(prompt.type).toBe("text");
    expect(prompt.tags).toEqual(["qa"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/public/v2/prompts/support.system");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuth("pk", "sk"));
  });

  it("reuses credentials and baseUrl from a langfuse tracing instance", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 3,
          prompt: "You are a support agent.",
          type: "text",
        }),
      ),
    );

    const tracing = langfuse.create({
      publicKey: "trace-pk",
      secretKey: "trace-sk",
      baseUrl: "https://trace.langfuse.test",
    });
    const client = createPromptClient(tracing);
    await client.getPrompt("support.system");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://trace.langfuse.test/api/public/v2/prompts/support.system");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuth("trace-pk", "trace-sk"));
  });

  it("prefers explicit prompt client options over tracing config", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 3,
          prompt: "You are a support agent.",
          type: "text",
        }),
      ),
    );

    const tracing = langfuse.create({
      publicKey: "trace-pk",
      secretKey: "trace-sk",
      baseUrl: "https://trace.langfuse.test",
    });
    const client = createPromptClient(tracing, {
      publicKey: "option-pk",
      secretKey: "option-sk",
      baseUrl: "https://option.langfuse.test",
    });
    await client.getPrompt("support.system");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://option.langfuse.test/api/public/v2/prompts/support.system");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuth("option-pk", "option-sk"));
  });

  it("falls back to env vars when given a custom tracing-like object", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "env-pk");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "env-sk");
    vi.stubEnv("LANGFUSE_BASE_URL", "https://env.langfuse.test");
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 3,
          prompt: "You are a support agent.",
          type: "text",
        }),
      ),
    );

    const client = createLangfusePromptClient({ score: async () => undefined });
    await client.getPrompt("support.system");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://env.langfuse.test/api/public/v2/prompts/support.system");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(basicAuth("env-pk", "env-sk"));
  });

  it("getPrompt includes ?version and ?label when supplied", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 2,
          prompt: "old",
          type: "text",
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await client.getPrompt("support.system", { version: 2, label: "staging" });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain("version=2");
    expect(url).toContain("label=staging");
  });

  it("getPrompt returns the cached value within the TTL", async () => {
    vi.mocked(fetch).mockReturnValue(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 1,
          prompt: "cached",
          type: "text",
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    const a = await client.getPrompt("support.system");
    const b = await client.getPrompt("support.system");
    expect(a).toBe(b);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("getPrompt refetches after the TTL elapses", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementation(async () =>
        makePromptJson({
          name: "support.system",
          version: 1,
          prompt: "fresh",
          type: "text",
        }),
      );

      const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
      const client = createPromptClient(tracing, {
        publicKey: "pk",
        secretKey: "sk",
        cacheTtlMs: 1000,
      });
      await client.getPrompt("support.system");
      vi.advanceTimersByTime(2000);
      await client.getPrompt("support.system");
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("getPrompt({ refresh: true }) skips the cache", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      makePromptJson({
        name: "support.system",
        version: 1,
        prompt: "fresh",
        type: "text",
      }),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await client.getPrompt("support.system");
    await client.getPrompt("support.system", { refresh: true });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("getPrompt throws on non-2xx with the response body", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(new Response("not found", { status: 404 })),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await expect(client.getPrompt("missing")).rejects.toThrow(/not found/);
  });

  it("getPromptText returns the string for type=text", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.system",
          version: 1,
          prompt: "You are a support agent.",
          type: "text",
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await expect(client.getPromptText("support.system")).resolves.toBe("You are a support agent.");
  });

  it("getPromptText throws when the prompt is type=chat", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.chat",
          version: 1,
          prompt: [{ role: "system", content: "hi" }],
          type: "chat",
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await expect(client.getPromptText("support.chat")).rejects.toThrow(/chat prompt/);
  });

  it("getPromptChat returns the array for type=chat", async () => {
    vi.mocked(fetch).mockReturnValueOnce(
      Promise.resolve(
        makePromptJson({
          name: "support.chat",
          version: 1,
          prompt: [
            { role: "system", content: "You are a support agent." },
            { role: "user", content: "Help!" },
          ],
          type: "chat",
        }),
      ),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await expect(client.getPromptChat("support.chat")).resolves.toEqual([
      { role: "system", content: "You are a support agent." },
      { role: "user", content: "Help!" },
    ]);
  });

  it("refresh() clears the cache", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      makePromptJson({
        name: "support.system",
        version: 1,
        prompt: "hi",
        type: "text",
      }),
    );

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const client = createPromptClient(tracing, { publicKey: "pk", secretKey: "sk" });
    await client.getPrompt("support.system");
    client.refresh();
    await client.getPrompt("support.system");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

describe("Langfuse prompt attribute binding", () => {
  it("attaches prompt name and version to the root when args.promptRef is set", async () => {
    const root = fakeObservation("root", "trace-prompt", "obs-root-prompt");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
      promptRef: { name: "support.system", version: 3 },
    });

    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.metadata.promptName",
      "support.system",
    );
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.metadata.promptVersion",
      "3",
    );
  });

  it("falls back to trace.metadata.promptName/promptVersion", async () => {
    const root = fakeObservation("root", "trace-prompt-2", "obs-root-prompt-2");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
      trace: { metadata: { promptName: "support.system", promptVersion: 2 } },
    });

    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.metadata.promptName",
      "support.system",
    );
    expect(root.otelSpan.setAttribute).toHaveBeenCalledWith(
      "langfuse.trace.metadata.promptVersion",
      "2",
    );
  });

  it("does not attach prompt attributes when neither source is set", async () => {
    const root = fakeObservation("root", "trace-prompt-3", "obs-root-prompt-3");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });

    const calls = (root.otelSpan.setAttribute as ReturnType<typeof vi.fn>).mock.calls;
    const promptCalls = calls.filter(
      ([key]) => typeof key === "string" && key.startsWith("langfuse.trace.metadata.prompt"),
    );
    expect(promptCalls).toEqual([]);
  });

  it("attaches prompt attributes to each generation in the run", async () => {
    const root = fakeObservation("root", "trace-prompt-4", "obs-root-prompt-4");
    const turn = fakeObservation("turn", "trace-prompt-4", "obs-turn-prompt-4");
    const generation = fakeObservation("generation", "trace-prompt-4", "obs-gen-prompt-4");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
      promptRef: { name: "support.system", version: 5 },
    });
    const runObserver = run as AgentRunObserver;

    await runObserver.startGeneration?.(generationStartArgs());

    expect(turn.startObservation).toHaveBeenCalledWith(
      "model.turn.1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          promptName: "support.system",
          promptVersion: 5,
        }),
      }),
      { asType: "generation" },
    );
  });
});

function createPromptClient(
  tracing: ReturnType<typeof langfuse.create>,
  options: Parameters<typeof createLangfusePromptClient>[1] = {},
): ReturnType<typeof createLangfusePromptClient> {
  return createLangfusePromptClient(tracing, options);
}

describe("PII redaction", () => {
  it("redacts a single email address", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactString("contact alice@example.com for details")).toBe(
      "contact [REDACTED] for details",
    );
  });

  it("redacts phone numbers in common shapes", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactString("Call (415) 555-1212 or +1 415-555-1313 today")).toBe(
      "Call [REDACTED] or [REDACTED] today",
    );
  });

  it("redacts IPv4 addresses", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactString("server 192.168.1.42 was down")).toBe("server [REDACTED] was down");
  });

  it("redacts JWT-shaped strings", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    const header = "eyJ".padEnd(36, "A");
    const middle = "B".repeat(20);
    const tail = "C".repeat(20);
    const jwt = `${header}.${middle}.${tail}`;
    expect(r.redactString(`token=${jwt}`)).toBe("token=[REDACTED]");
  });

  it("redacts common API-key shapes", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactString("use sk-abcdefghijklmnopqrstuv to authenticate")).toBe(
      "use [REDACTED] to authenticate",
    );
  });

  it("redacts credit-card-shaped sequences that pass Luhn", async () => {
    const { createPiiRedactor, passesLuhn } = await import("../src/redaction");
    expect(passesLuhn("4111111111111111")).toBe(true);
    const r = createPiiRedactor();
    expect(r.redactString("card 4111-1111-1111-1111 today")).toBe("card [REDACTED] today");
  });

  it("does not redact credit-card-shaped sequences that fail Luhn", async () => {
    const { createPiiRedactor, passesLuhn } = await import("../src/redaction");
    expect(passesLuhn("4111111111111112")).toBe(false);
    const r = createPiiRedactor();
    expect(r.redactString("not a card: 4111111111111112")).toBe("not a card: 4111111111111112");
  });

  it("redacts multiple patterns in a single string", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactString("from alice@example.com to 10.0.0.1 at 415-555-1212")).toBe(
      "from [REDACTED] to [REDACTED] at [REDACTED]",
    );
  });

  it("uses the configured replacement", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor({ replacement: "<HIDDEN>" });
    expect(r.redactString("alice@example.com")).toBe("<HIDDEN>");
  });

  it("redactMessages redacts text inside message content", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    const out = r.redactMessages([
      { role: "user", content: [{ type: "text", text: "hi alice@example.com" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "use 10.0.0.1" },
          { type: "tool_call", id: "c", function: { name: "x", arguments: {} } },
        ],
      },
    ]);
    expect(out[0]?.content[0]).toMatchObject({ text: "hi [REDACTED]" });
    expect(out[1]?.content[0]).toMatchObject({ text: "use [REDACTED]" });
    expect(out[1]?.content[1]).toEqual({
      type: "tool_call",
      id: "c",
      function: { name: "x", arguments: {} },
    });
  });

  it("redactObject recurses into nested objects and arrays", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    const out = r.redactObject({
      contact: "alice@example.com",
      list: ["server 10.0.0.1", { nested: "call 415-555-1212" }],
    });
    expect(out).toEqual({
      contact: "[REDACTED]",
      list: ["server [REDACTED]", { nested: "call [REDACTED]" }],
    });
  });

  it("redactObject returns primitives unchanged", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.redactObject(42)).toBe(42);
    expect(r.redactObject(null)).toBe(null);
    expect(r.redactObject(true)).toBe(true);
  });

  it("patternNames returns the configured pattern names", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor();
    expect(r.patternNames()).toEqual(["email", "creditCard", "ipv4", "phone", "jwt", "apiKey"]);
  });

  it("custom patterns replace the default set", async () => {
    const { createPiiRedactor } = await import("../src/redaction");
    const r = createPiiRedactor({
      patterns: [{ name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g }],
    });
    expect(r.patternNames()).toEqual(["ssn"]);
    expect(r.redactString("ssn 123-45-6789 not alice@example.com")).toBe(
      "ssn [REDACTED] not alice@example.com",
    );
  });
});

describe("Langfuse redaction integration", () => {
  it("is off by default: an email in args.prompt flows through unchanged", async () => {
    const root = fakeObservation("root", "trace-redact-1", "obs-root-redact-1");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({ publicKey: "pk", secretKey: "sk" });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("email alice@example.com please"),
      history: [],
      maxTurns: 1,
    });

    const inputArg = mocks.startObservation.mock.calls[0]?.[1] as {
      input: { prompt: { content: Array<{ text?: string }> } };
    };
    const text = inputArg.input.prompt.content[0]?.text;
    expect(text).toBe("email alice@example.com please");
  });

  it("with redactInputs: true the email is replaced with [REDACTED]", async () => {
    const root = fakeObservation("root", "trace-redact-2", "obs-root-redact-2");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactInputs: true,
    });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("email alice@example.com please"),
      history: [userMessage("also bob@example.com")],
      maxTurns: 1,
    });

    const inputArg = mocks.startObservation.mock.calls[0]?.[1] as {
      input: {
        prompt: { content: Array<{ text?: string }> };
        history: Array<{ content: Array<{ text?: string }> }>;
      };
    };
    expect(inputArg.input.prompt.content[0]?.text).toBe("email [REDACTED] please");
    expect(inputArg.input.history[0]?.content[0]?.text).toBe("also [REDACTED]");
  });

  it("with redactInputs: 'deep' the chat history text is also redacted", async () => {
    const root = fakeObservation("root", "trace-redact-3", "obs-root-redact-3");
    const turn = fakeObservation("turn", "trace-redact-3", "obs-turn-redact-3");
    const generation = fakeObservation("generation", "trace-redact-3", "obs-gen-redact-3");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactInputs: "deep",
    });
    const run = await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    });
    if (!run?.startGeneration) throw new Error("missing startGeneration");
    await run.startGeneration({
      ...generationStartArgs(),
      request: {
        ...generationStartArgs().request,
        chatHistory: [userMessage("hello alice@example.com")],
      },
    });

    const call = turn.startObservation.mock.calls[0];
    const input = (call?.[1] as { input: Array<{ content: Array<{ text?: string }> }> }).input;
    expect(input[0]?.content[0]?.text).toBe("hello [REDACTED]");
  });

  it("with redactOutputs: true the generation output text is redacted", async () => {
    const root = fakeObservation("root", "trace-redact-4", "obs-root-redact-4");
    const turn = fakeObservation("turn", "trace-redact-4", "obs-turn-redact-4");
    const generation = fakeObservation("generation", "trace-redact-4", "obs-gen-redact-4");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactOutputs: true,
    });
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
        choice: [AssistantContent.text("reply to alice@example.com")],
        usage: usage(1, 2),
        rawResponse: {},
      },
    });

    const updateCall = generation.update.mock.calls.at(-1)?.[0] as {
      output: { text: string };
    };
    expect(updateCall.output.text).toBe("reply to [REDACTED]");
  });

  it("with redactOutputs: 'deep' the choice array is deeply redacted", async () => {
    const root = fakeObservation("root", "trace-redact-5", "obs-root-redact-5");
    const turn = fakeObservation("turn", "trace-redact-5", "obs-turn-redact-5");
    const generation = fakeObservation("generation", "trace-redact-5", "obs-gen-redact-5");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(generation);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactOutputs: "deep",
    });
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
        choice: [AssistantContent.text("server 10.0.0.1")],
        usage: usage(1, 2),
        rawResponse: {},
      },
    });

    const updateCall = generation.update.mock.calls.at(-1)?.[0] as {
      output: { content: Array<{ text?: string }> };
    };
    const text = updateCall.output.content[0]?.text;
    expect(text).toBe("server [REDACTED]");
  });

  it("redacts tool args and result when the corresponding mode is on", async () => {
    const root = fakeObservation("root", "trace-redact-6", "obs-root-redact-6");
    const turn = fakeObservation("turn", "trace-redact-6", "obs-turn-redact-6");
    const tool = fakeObservation("tool", "trace-redact-6", "obs-tool-redact-6");
    root.startObservation.mockReturnValueOnce(turn);
    turn.startObservation.mockReturnValueOnce(tool);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactInputs: true,
      redactOutputs: true,
    });
    const run = (await tracing.startRun({
      agentName: "support",
      prompt: userMessage("hi"),
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    const toolObserver = (await run.startTool?.({
      turn: 1,
      toolName: "lookup",
      args: '{"email":"alice@example.com"}',
      toolCall: AssistantContent.toolCall("c-1", "lookup", { email: "alice@example.com" }),
      internalCallId: "i-1",
      toolCallId: "c-1",
    })) as AgentToolObserver;

    const startCall = turn.startObservation.mock.calls[0];
    const startInput = (startCall?.[1] as { input: { args: string } }).input;
    expect(startInput.args).toBe('{"email":"[REDACTED]"}');

    await toolObserver?.end({
      turn: 1,
      toolName: "lookup",
      args: '{"email":"alice@example.com"}',
      toolCall: AssistantContent.toolCall("c-1", "lookup", { email: "alice@example.com" }),
      internalCallId: "i-1",
      toolCallId: "c-1",
      result: "wrote to alice@example.com",
      skipped: false,
    });

    const endCall = tool.update.mock.calls.at(-1)?.[0] as { output: string };
    expect(endCall.output).toBe("wrote to [REDACTED]");
  });

  it("redaction.replacement propagates to the redactor", async () => {
    const root = fakeObservation("root", "trace-redact-7", "obs-root-redact-7");
    root.startObservation.mockReturnValue(root);
    mocks.startObservation.mockReturnValueOnce(root);

    const tracing = langfuse.create({
      publicKey: "pk",
      secretKey: "sk",
      redactInputs: true,
      redaction: { replacement: "<HIDDEN>" },
    });
    await tracing.startRun({
      agentName: "support",
      prompt: userMessage("alice@example.com"),
      history: [],
      maxTurns: 1,
    });

    const inputArg = mocks.startObservation.mock.calls[0]?.[1] as {
      input: { prompt: { content: Array<{ text?: string }> } };
    };
    expect(inputArg.input.prompt.content[0]?.text).toBe("<HIDDEN>");
  });
});
