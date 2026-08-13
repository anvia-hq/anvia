import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentRunCancelledError,
  AssistantContent,
  assertCompleted,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  type ContextUsage,
  cancelRun,
  createHook,
  createMiddleware,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineInputGuardrail,
  getAssistantGenerationMetadata,
  type MemoryAppendInput,
  type MemoryContext,
  type MemoryErrorInput,
  type MemorySavePolicy,
  type MemoryStore,
  Message,
  type Message as MessageType,
  type StreamingCompletionModel,
  TestAgentBuilder,
  Usage,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    yield* response;
  }
}

class RecordingMemoryStore implements MemoryStore {
  readonly appendCalls: MemoryAppendInput[] = [];
  readonly errorCalls: MemoryErrorInput[] = [];
  readonly loadCalls: MemoryContext[] = [];
  private readonly sessions = new Map<string, MessageType[]>();

  constructor(initial: Record<string, MessageType[]> = {}) {
    for (const [sessionId, messages] of Object.entries(initial)) {
      this.sessions.set(sessionId, messages);
    }
  }

  async load(context: MemoryContext): Promise<MessageType[]> {
    this.loadCalls.push({ ...context });
    return [...(this.sessions.get(context.sessionId) ?? [])];
  }

  async append(input: MemoryAppendInput): Promise<void> {
    this.appendCalls.push({ ...input, messages: [...input.messages] });
    const current = this.sessions.get(input.context.sessionId) ?? [];
    this.sessions.set(input.context.sessionId, [...current, ...input.messages]);
  }

  async clear(context: MemoryContext): Promise<void> {
    this.sessions.delete(context.sessionId);
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    this.errorCalls.push({ ...input, messages: [...input.messages] });
  }
}

function response(
  choice: CompletionResponse["choice"],
  usage: CompletionResponse["usage"] = Usage.empty(),
  contextUsage?: ContextUsage,
): CompletionResponse {
  return {
    choice,
    usage,
    ...(contextUsage === undefined ? {} : { contextUsage }),
    rawResponse: {},
  };
}

const addTool = createTool({
  name: "add",
  description: "Add numbers",
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  outputSchema: z.number(),
  execute: (args) => args.x + args.y,
});

describe("agent memory", () => {
  it("uses prompt transcripts as stateless history", async () => {
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new TestAgentBuilder("test-agent", model).build();
    const transcript = [
      Message.user("My project is named Anvia."),
      Message.assistant("Noted."),
      Message.user("What is my project named?"),
    ];

    await agent.generate(transcript);

    expect(model.requests[0]?.chatHistory).toEqual(transcript);
  });

  it("rejects empty prompt transcripts", async () => {
    const model = new QueueModel([]);
    const agent = new TestAgentBuilder("test-agent", model).build();

    expect(() => agent.generate([])).toThrow("at least one message");
  });

  it("loads session messages before running", async () => {
    const previous = [Message.user("My project is named Anvia."), Message.assistant("Noted.")];
    const store = new RecordingMemoryStore({ session_1: previous });
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new TestAgentBuilder("test-agent", model).memory(store).build();

    await agent.session("session_1").generate("What is my project named?");

    expect(model.requests[0]?.chatHistory).toEqual([
      ...previous,
      Message.user("What is my project named?"),
    ]);
    expect(store.loadCalls).toHaveLength(1);
  });

  it("exposes stored history to lifecycle, observers, and input guardrails before a buffered run", async () => {
    const previous = [Message.user("Previous question"), Message.assistant("Previous answer")];
    const store = new RecordingMemoryStore({ session_1: previous });
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    let lifecycleHistory: unknown;
    let observerHistory: readonly unknown[] | undefined;
    let guardrailHistory: MessageType[] | undefined;
    const agent = new Agent({
      id: "test-agent",
      model,
      memory: { store },
      lifecycle: {
        onStart({ history }) {
          lifecycleHistory = history;
        },
      },
      observers: [
        createObserver({
          startRun({ history }) {
            observerHistory = history;
            return { end() {} };
          },
        }),
      ],
      guardrails: defineGuardrailPolicy({
        id: "history-policy",
        input: [
          defineInputGuardrail({
            id: "history-guardrail",
            check({ history }, { allow }) {
              guardrailHistory = history;
              return allow();
            },
          }),
        ],
      }),
    });

    await agent.session("session_1").generate("next");

    expect(lifecycleHistory).toEqual(previous);
    expect(observerHistory).toEqual(previous);
    expect(guardrailHistory).toEqual(previous);
    expect(store.loadCalls).toHaveLength(1);
    expect(model.requests[0]?.chatHistory).toEqual([...previous, Message.user("next")]);
  });

  it("exposes stored history before a streaming run without loading it twice", async () => {
    const previous = [Message.user("Previous question"), Message.assistant("Previous answer")];
    const store = new RecordingMemoryStore({ session_1: previous });
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    let lifecycleHistory: unknown;
    let observerHistory: readonly unknown[] | undefined;
    let guardrailHistory: MessageType[] | undefined;
    const agent = new Agent({
      id: "test-agent",
      model,
      memory: { store },
      lifecycle: {
        onStart({ history }) {
          lifecycleHistory = history;
        },
      },
      observers: [
        createObserver({
          startRun({ history }) {
            observerHistory = history;
            return { end() {} };
          },
        }),
      ],
      guardrails: defineGuardrailPolicy({
        id: "history-policy",
        input: [
          defineInputGuardrail({
            id: "history-guardrail",
            check({ history }, { allow }) {
              guardrailHistory = history;
              return allow();
            },
          }),
        ],
      }),
    });

    for await (const _event of agent.session("session_1").stream("next")) {
      // exhaust the stream
    }

    expect(lifecycleHistory).toEqual(previous);
    expect(observerHistory).toEqual(previous);
    expect(guardrailHistory).toEqual(previous);
    expect(store.loadCalls).toHaveLength(1);
    expect(model.requests[0]?.chatHistory).toEqual([...previous, Message.user("next")]);
  });

  it("does not persist a session prompt rejected by an input guardrail", async () => {
    const previous = [Message.user("Previous question"), Message.assistant("Previous answer")];
    const store = new RecordingMemoryStore({ session_1: previous });
    const model = new QueueModel([]);
    let guardrailHistory: MessageType[] | undefined;
    const agent = new Agent({
      id: "test-agent",
      model,
      memory: { store },
      guardrails: defineGuardrailPolicy({
        id: "history-policy",
        input: [
          defineInputGuardrail({
            id: "block-input",
            check({ history }, { block }) {
              guardrailHistory = history;
              return block({ reason: "blocked", message: "Input blocked." });
            },
          }),
        ],
      }),
    });

    await expect(agent.session("session_1").generate("blocked prompt")).resolves.toMatchObject({
      status: "completed",
      output: "Input blocked.",
    });

    expect(guardrailHistory).toEqual(previous);
    expect(store.loadCalls).toHaveLength(1);
    expect(store.appendCalls).toHaveLength(0);
    expect(model.requests).toHaveLength(0);
    await expect(agent.session("session_1").messages()).resolves.toEqual(previous);
    expect(store.loadCalls).toHaveLength(2);
  });

  it("applies completion retries to session prompts without duplicating memory", async () => {
    const store = new RecordingMemoryStore();
    const delegate = new QueueModel([response([AssistantContent.text("recovered")])]);
    let attempts = 0;
    const model: CompletionModel = {
      provider: delegate.provider,
      defaultModel: delegate.defaultModel,
      capabilities: delegate.capabilities,
      async completion(request) {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
        }
        return delegate.completion(request);
      },
    };
    const agent = new TestAgentBuilder("test-agent", model).memory(store).build();

    await expect(
      agent
        .session("session_1")
        .generate("hello", { retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    ).resolves.toMatchObject({ output: "recovered" });

    expect(attempts).toBe(2);
    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant"],
    ]);
  });

  it("saves messages incrementally by default", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new TestAgentBuilder("test-agent", model).memory(store).tools([addTool]).build();

    await agent.session("session_1").generate("add");

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant", "tool"],
      ["assistant"],
    ]);
    await expect(agent.session("session_1").messages()).resolves.toHaveLength(4);
  });

  it("does not persist an orphaned assistant tool call while approval is pending", async () => {
    const store = new RecordingMemoryStore();
    const guardedTool = createTool({
      name: "guarded",
      description: "Run a guarded operation",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute: () => "approved",
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [guardedTool],
      memory: { store },
    });
    const session = agent.session("session_1");

    const pending = await session.generate("run guarded");
    expect(pending.status).toBe("approval_required");
    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
    ]);
    await expect(session.messages()).resolves.toEqual([Message.user("run guarded")]);
    if (pending.status !== "approval_required") throw new Error("Expected approval");

    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      status: "completed",
      output: "done",
    });
    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant", "tool"],
      ["assistant"],
    ]);
  });

  it.each<MemorySavePolicy>([
    "message",
    "turn",
    "run",
  ])("persists per-generation usage and the effective model with the %s save policy", async (savePolicy) => {
    const store = new RecordingMemoryStore();
    const firstUsage = {
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 0,
    };
    const secondUsage = {
      inputTokens: 20,
      outputTokens: 1,
      totalTokens: 21,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 4,
    };
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })], firstUsage),
      response([AssistantContent.text("7")], secondUsage),
    ]);
    const agent = new TestAgentBuilder("test-agent", model)
      .memory(store, { savePolicy })
      .middlewares([
        createMiddleware({
          onCompletionRequest({ request }) {
            return { request: { ...request, model: "test-override" } };
          },
        }),
      ])
      .tools([addTool])
      .build();

    const result = await agent.session("session-generation-metadata").generate("add");
    const resultMetadata = result.messages
      .filter((message) => message.role === "assistant")
      .map(getAssistantGenerationMetadata);
    const persistedMetadata = store.appendCalls
      .flatMap((call) => call.messages)
      .filter((message) => message.role === "assistant")
      .map(getAssistantGenerationMetadata);
    const expected = [
      { provider: "test", model: "test-override", usage: firstUsage },
      { provider: "test", model: "test-override", usage: secondUsage },
    ];

    expect(resultMetadata).toEqual(expected);
    expect(persistedMetadata).toEqual(expected);
  });

  it("persists and returns the latest context usage for a session", async () => {
    const store = new RecordingMemoryStore();
    const contextUsage: ContextUsage = {
      model: { id: "test", context: { contextWindow: 100, maxOutputTokens: 20 } },
      usedTokens: 25,
      remainingTokens: 75,
      usedPercent: 25,
      remainingPercent: 75,
    };
    const model = new QueueModel([
      response(
        [AssistantContent.text("done")],
        {
          inputTokens: 20,
          outputTokens: 5,
          totalTokens: 25,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        contextUsage,
      ),
      response([AssistantContent.text("unknown model")], {
        inputTokens: 30,
        outputTokens: 5,
        totalTokens: 35,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
    ]);
    const agent = new TestAgentBuilder("test-agent", model).memory(store).build();
    const session = agent.session("context-usage");

    const result = await session.generate("hello");
    assertCompleted(result);

    expect(result.contextUsage).toEqual(contextUsage);
    await expect(session.contextUsage()).resolves.toEqual(contextUsage);

    const unknownResult = await session.generate("switch model");
    assertCompleted(unknownResult);
    expect(unknownResult.contextUsage).toBeUndefined();
    await expect(session.contextUsage()).resolves.toBeUndefined();
  });

  it("records failed runs after preserving completed messages", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
    ]);
    const agent = new TestAgentBuilder("test-agent", model).memory(store).tools([addTool]).build();

    await expect(agent.session("session_1").generate("add")).rejects.toThrow("No queued response");

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant", "tool"],
    ]);
    expect(store.errorCalls).toHaveLength(1);
    expect(store.errorCalls[0]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("rejects malformed streamed tool arguments before execution or assistant persistence", async () => {
    const store = new RecordingMemoryStore();
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "tool_0",
          name: "Probe",
          argumentsDelta: "{}",
        },
        {
          type: "tool_call_delta",
          id: "tool_1",
          callId: "call_abc",
          name: "ExecCommand",
          argumentsDelta: '{"command":"pwd"',
        },
      ],
      [{ type: "text_delta", delta: "recovered" }],
    ]);
    let probeExecutions = 0;
    let commandExecutions = 0;
    const completionErrors: string[] = [];
    const probeTool = createTool({
      name: "Probe",
      description: "Record whether a sibling tool executes",
      inputSchema: z.object({}),
      execute: () => {
        probeExecutions += 1;
        return "probed";
      },
    });
    const execCommandTool = createTool({
      name: "ExecCommand",
      description: "Execute a command",
      inputSchema: z.object({ command: z.string() }),
      execute: () => {
        commandExecutions += 1;
        return "executed";
      },
    });
    const agent = new TestAgentBuilder("test-agent", model)
      .memory(store)
      .tools([probeTool])
      .tools([execCommandTool])
      .hook(
        createHook({
          onCompletionError({ error }) {
            completionErrors.push(error instanceof Error ? error.message : String(error));
          },
        }),
      )
      .build();
    const session = agent.session("session_1");

    const runMalformedStream = async () => {
      for await (const _event of session.stream("run tools")) {
        // exhaust the stream
      }
    };
    await expect(runMalformedStream()).rejects.toThrow(
      'Completion returned tool call "tool_1" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
    );

    expect(probeExecutions).toBe(0);
    expect(commandExecutions).toBe(0);
    expect(completionErrors).toEqual([
      'Completion returned tool call "tool_1" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
    ]);
    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
    ]);
    expect(store.errorCalls).toHaveLength(1);
    expect(store.errorCalls[0]?.messages).toEqual([Message.user("run tools")]);
    await expect(session.messages()).resolves.toEqual([Message.user("run tools")]);

    for await (const _event of session.stream("continue")) {
      // exhaust the stream
    }

    expect(model.requests[1]?.chatHistory).toEqual([
      Message.user("run tools"),
      Message.user("continue"),
    ]);
  });

  it("supports turn save policy", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new TestAgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "turn" })
      .tools([addTool])
      .build();

    await agent.session("session_1").generate("add");

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user", "assistant", "tool"],
      ["assistant"],
    ]);
  });

  it("supports run save policy", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new TestAgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "run" })
      .build();

    await agent.session("session_1").generate("hello");

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user", "assistant"],
    ]);
  });

  it.each([
    "buffered",
    "streaming",
  ] as const)("commits %s run memory before reporting success", async (mode) => {
    const events: string[] = [];
    const persistenceError = new Error("memory append failed");
    const store: MemoryStore = {
      async load() {
        return [];
      },
      async append() {
        events.push("memory:append");
        throw persistenceError;
      },
      async clear() {},
      async recordError() {
        events.push("memory:error");
      },
    };
    const model: CompletionModel =
      mode === "buffered"
        ? new QueueModel([response([AssistantContent.text("done")])])
        : new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    const agent = new Agent({
      id: "test-agent",
      model,
      memory: { store, savePolicy: "run" },
      lifecycle: {
        onFinish() {
          events.push("lifecycle:finish");
        },
        onError() {
          events.push("lifecycle:error");
        },
      },
      observers: [
        createObserver({
          startRun() {
            return {
              end() {
                events.push("observer:end");
              },
              error() {
                events.push("observer:error");
              },
            };
          },
        }),
      ],
    });
    const session = agent.session(`session-${mode}`);
    const execution =
      mode === "buffered"
        ? session.generate("hello")
        : (async () => {
            for await (const _event of session.stream("hello")) {
              // exhaust the stream
            }
          })();

    await expect(execution).rejects.toBe(persistenceError);
    expect(events).toEqual(["memory:append", "lifecycle:error", "observer:error", "memory:error"]);
  });

  it("does not commit run memory when the run end hook cancels", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new TestAgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "run" })
      .hook(
        createHook({
          onRunEnd() {
            return cancelRun("blocked at end");
          },
        }),
      )
      .build();

    await expect(agent.session("session_1").generate("hello")).rejects.toBeInstanceOf(
      AgentRunCancelledError,
    );

    expect(store.appendCalls).toHaveLength(0);
    expect(store.errorCalls).toHaveLength(1);
  });

  it("does not save nested streaming agent-tool events as memory messages", async () => {
    const store = new RecordingMemoryStore();
    const parentModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "inspect" }),
        },
      ],
      [{ type: "text_delta", delta: "parent done" }],
    ]);
    const childModel = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "child " },
        { type: "text_delta", delta: "done" },
      ],
    ]);
    const childAgent = new TestAgentBuilder("child", childModel).build();
    const parentAgent = new TestAgentBuilder("parent", parentModel)
      .memory(store)
      .tools([childAgent.asTool({ name: "ask_child", stream: true })])
      .build();

    for await (const _event of parentAgent.session("session_1").stream("delegate")) {
      // exhaust stream
    }

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant", "tool"],
      ["assistant"],
    ]);
    await expect(parentAgent.session("session_1").messages()).resolves.toHaveLength(4);
  });

  it("rejects transcript input for session runs", () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([]);
    const agent = new TestAgentBuilder("test-agent", model).memory(store).build();
    const generate = agent.session("session_1").generate as unknown as (
      input: MessageType[],
    ) => unknown;

    expect(() => generate([Message.user("hello")])).toThrow("does not accept Message[]");
  });
});
