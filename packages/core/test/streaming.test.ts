import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  type AgentEventAppendInput,
  type AgentEventRecord,
  type AgentEventStore,
  type AgentStreamEvent,
  AssistantContent,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  cancelPrompt,
  createHook,
  createMiddleware,
  createTool,
  createToolMiddleware,
  getAssistantGenerationMetadata,
  Message,
  PromptCancelledError,
  type StreamingCompletionModel,
  ToolOutput,
  toReadableStream,
} from "./helpers/imports";

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

  constructor(
    private readonly responses: Array<
      Iterable<CompletionStreamEvent> | AsyncIterable<CompletionStreamEvent>
    >,
  ) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    for await (const event of response) {
      yield event;
    }
  }
}

async function* streamThenThrow(
  events: CompletionStreamEvent[],
  error: unknown,
): AsyncIterable<CompletionStreamEvent> {
  yield* events;
  throw error;
}

class RecordingEventStore implements AgentEventStore {
  readonly appendCalls: AgentEventAppendInput[] = [];

  async append(input: AgentEventAppendInput): Promise<void> {
    this.appendCalls.push(input);
  }

  async load(runId: string): Promise<AgentEventRecord[]> {
    return this.appendCalls.filter((call) => call.runId === runId);
  }

  async clear(runId: string): Promise<void> {
    const remaining = this.appendCalls.filter((call) => call.runId !== runId);
    this.appendCalls.length = 0;
    this.appendCalls.push(...remaining);
  }
}

const addTool = createTool({
  name: "add",
  description: "Add numbers",
  input: z.object({
    x: z.number(),
    y: z.number(),
  }),
  output: z.number(),
  execute: (args) => args.x + args.y,
});

describe("PromptRequest streaming", () => {
  it("streams text deltas and final response", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "hel" },
        { type: "text_delta", delta: "lo" },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).instructions("system").build();

    const events = await collect(agent.prompt("hi").stream());

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "text_delta",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "hello" });
    expect(model.requests[0]?.instructions).toBe("system");
    expect(model.requests[0]?.chatHistory[0]).toEqual(Message.user("hi"));
  });

  it("retries a transient stream failure before the first provider event", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([], error),
      [{ type: "text_delta", delta: "recovered" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(
      agent.prompt("hi").withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 }).stream(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "recovered" });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });

  it("retries an initial provider error event without exposing it", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { statusCode: 503 });
    const model = new StreamingQueueModel([
      [{ type: "error", error }],
      [{ type: "text_delta", delta: "ready" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(
      agent.prompt("hi").withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 }).stream(),
    );

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "ready" });
    expect(model.requests).toHaveLength(2);
  });

  it("applies completion retries through PromptRequest readable streams", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([], error),
      [{ type: "text_delta", delta: "ready" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const text = await readAll(
      agent
        .prompt("hi")
        .withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 })
        .readableStream(),
    );
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "ready" });
    expect(model.requests).toHaveLength(2);
  });

  it("does not retry after a provider delta has been observed", async () => {
    const error = Object.assign(new Error("stream interrupted"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([{ type: "text_delta", delta: "partial" }], error),
      [{ type: "text_delta", delta: "duplicate" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();
    const iterator = agent
      .prompt("hi")
      .withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 })
      .stream()
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toMatchObject({ type: "text_delta", delta: "partial" });
    expect(await nextEvent(iterator)).toEqual({ type: "error", error });
    await expect(iterator.next()).rejects.toBe(error);
    expect(model.requests).toHaveLength(1);
  });

  it("does not retry after a non-emitted provider event has been observed", async () => {
    const error = Object.assign(new Error("stream interrupted"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([{ type: "message_id", id: "msg_1" }], error),
      [{ type: "text_delta", delta: "duplicate" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();
    const iterator = agent
      .prompt("hi")
      .withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 })
      .stream()
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toEqual({ type: "error", error });
    await expect(iterator.next()).rejects.toBe(error);
    expect(model.requests).toHaveLength(1);
  });

  it("streams post-middleware response content when response middleware is registered", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "secret" }]]);
    const agent = new AgentBuilder("test-agent", model)
      .middleware(
        createMiddleware({
          onCompletionResponse({ response }) {
            return {
              response: {
                ...response,
                choice: [AssistantContent.text("safe")],
              },
            };
          },
        }),
      )
      .build();

    const events = await collect(agent.prompt("hi").stream());
    const textDeltas = events
      .filter((event): event is Extract<AgentStreamEvent, { type: "text_delta" }> => {
        return event.type === "text_delta";
      })
      .map((event) => event.delta);

    expect(textDeltas).toEqual(["safe"]);
    expect(events.at(-1)).toMatchObject({ type: "final", output: "safe" });
  });

  it("does not emit final before the run end hook succeeds", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    const agent = new AgentBuilder("test-agent", model)
      .hook(
        createHook({
          onRunEnd() {
            return cancelPrompt("blocked at end");
          },
        }),
      )
      .build();
    const iterator = agent.prompt("hi").stream()[Symbol.asyncIterator]();
    const events: AgentStreamEvent[] = [];

    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "text_delta",
      "turn_end",
      "error",
    ]);
    await expect(iterator.next()).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it("rejects concurrent stream execution on the same prompt request", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    const agent = new AgentBuilder("test-agent", model).build();
    const request = agent.prompt("hi");
    const iterator = request.stream()[Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    await expect(collect(request.stream())).rejects.toThrow("PromptRequest is already running.");

    const rest = await collectIterator(iterator);
    expect(rest.at(-1)).toMatchObject({ type: "final", output: "done" });
  });

  it("continues when steering arrives before a no-tool response finalizes", async () => {
    const model = new StreamingQueueModel([
      [{ type: "text_delta", delta: "first" }],
      [{ type: "text_delta", delta: "second" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();
    const request = agent.prompt("hi");
    const iterator = request.stream()[Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({
      type: "turn_start",
      turn: 1,
      prompt: Message.user("hi"),
    });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "text_delta",
      turn: 1,
      delta: "first",
    });
    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_end", turn: 1 });

    expect(request.steer("revise")).toBe(true);

    const rest = await collectIterator(iterator);
    expect(rest.map((event) => event.type)).toEqual([
      "turn_start",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(rest[0]).toMatchObject({
      type: "turn_start",
      turn: 2,
      prompt: Message.user("revise"),
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(Message.user("revise"));
    expect(rest.at(-1)).toMatchObject({
      type: "final",
      output: "second",
      messages: [
        Message.user("hi"),
        Message.assistant("first"),
        Message.user("revise"),
        Message.assistant("second"),
      ],
    });
  });

  it("appends steering after tool results before the next completion turn", async () => {
    const toolStarted = deferred<void>();
    const toolRelease = deferred<number>();
    const slowAddTool = createTool({
      name: "slow_add",
      description: "Add numbers slowly",
      input: z.object({
        x: z.number(),
        y: z.number(),
      }),
      output: z.number(),
      async execute(args) {
        toolStarted.resolve();
        await toolRelease.promise;
        return args.x + args.y;
      },
    });
    const toolCall = AssistantContent.toolCall("call_1", "slow_add", { x: 2, y: 5 });
    const model = new StreamingQueueModel([
      [{ type: "tool_call", toolCall }],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(slowAddTool).build();
    const request = agent.prompt("add");
    const eventsPromise = collect(request.stream());

    await toolStarted.promise;
    expect(request.steer("also explain")).toBe(true);
    toolRelease.resolve(7);

    const events = await eventsPromise;
    expect(events.at(-1)).toMatchObject({ type: "final", output: "done" });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.slice(-3)).toEqual([
      expect.objectContaining(Message.assistant([toolCall])),
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "slow_add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
      Message.user("also explain"),
    ]);
  });

  it("consumes multiple steering calls in FIFO order", async () => {
    const model = new StreamingQueueModel([
      [{ type: "text_delta", delta: "base" }],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();
    const request = agent.prompt("start");
    const iterator = request.stream()[Symbol.asyncIterator]();
    const firstSteer = Message.user("first steer");
    const secondSteer = Message.user("second steer");

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "text_delta", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_end", turn: 1 });

    expect(request.steer(firstSteer)).toBe(true);
    expect(request.steer([secondSteer])).toBe(true);

    const rest = await collectIterator(iterator);
    expect(rest[0]).toMatchObject({
      type: "turn_start",
      turn: 2,
      prompt: secondSteer,
    });
    expect(model.requests[1]?.chatHistory.slice(-3)).toEqual([
      expect.objectContaining(Message.assistant("base")),
      firstSteer,
      secondSteer,
    ]);
    expect(rest.at(-1)).toMatchObject({
      type: "final",
      messages: [
        Message.user("start"),
        Message.assistant("base"),
        firstSteer,
        secondSteer,
        Message.assistant("done"),
      ],
    });
  });

  it("merges usage-only final stream responses with accumulated text", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "hel" },
        { type: "text_delta", delta: "lo" },
        {
          type: "final",
          response: {
            choice: [],
            usage: {
              inputTokens: 2,
              outputTokens: 1,
              totalTokens: 3,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
            rawResponse: {},
          },
        },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(agent.prompt("hi").stream());

    expect(events.at(-1)).toMatchObject({
      type: "final",
      output: "hello",
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      },
    });
    const finalEvent = events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("Expected a final event");
    }
    const assistantMessage = finalEvent.messages.at(-1);
    expect(assistantMessage && getAssistantGenerationMetadata(assistantMessage)).toEqual({
      provider: "test",
      model: "test",
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
  });

  it("streams automatic tool execution across turns", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).build();

    const events = await collect(agent.prompt("add").stream());

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        turn: 1,
        toolName: "add",
        args: '{"x":2,"y":5}',
        result: "7",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", output: "7" });
    expect(model.requests).toHaveLength(2);
  });

  it("streams transformed tool results from middleware", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .toolMiddleware(
        createToolMiddleware({
          onResult({ result }) {
            return `stored:${result}`;
          },
        }),
      )
      .build();

    const events = await collect(agent.prompt("add").stream());

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        turn: 1,
        toolName: "add",
        result: "stored:7",
      }),
    );
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "stored:7" }],
        },
      ]),
    );
  });

  it("streams structured tool results with a display string", async () => {
    const structuredContent = ToolOutput.content([
      { type: "text", text: "screen" },
      { type: "image", data: "base64-png", mediaType: "image/png" },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      input: z.object({}),
      execute: () => structuredContent,
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_1", "computer_screenshot", {}),
        },
      ],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const eventStore = new RecordingEventStore();
    const agent = new AgentBuilder("test-agent", model)
      .tool(screenshotTool)
      .eventStore(eventStore, { include: "all" })
      .build();

    const events = await collect(agent.prompt("screenshot").stream());

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        turn: 1,
        toolName: "computer_screenshot",
        result: "screen\n[image:image/png]",
        structuredResult: structuredContent,
      }),
    );
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "computer_screenshot",
          content: structuredContent,
        },
      ]),
    );
    expect(
      eventStore.appendCalls.some((call) => {
        const event = JSON.parse(JSON.stringify(call.event)) as AgentStreamEvent;
        return (
          event.type === "tool_result" &&
          event.result === "screen\n[image:image/png]" &&
          event.structuredResult?.[1]?.type === "image"
        );
      }),
    ).toBe(true);
  });

  it("streams concurrent tool results as each tool finishes", async () => {
    const slowRelease = deferred<void>();
    const slowStarted = deferred<void>();
    const fastStarted = deferred<void>();
    const slowTool = createTool({
      name: "slow_tool",
      description: "Slow tool",
      input: z.object({}),
      output: z.string(),
      async execute() {
        slowStarted.resolve();
        await slowRelease.promise;
        return "slow";
      },
    });
    const fastTool = createTool({
      name: "fast_tool",
      description: "Fast tool",
      input: z.object({}),
      output: z.string(),
      async execute() {
        fastStarted.resolve();
        return "fast";
      },
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_slow", "slow_tool", {}),
        },
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_fast", "fast_tool", {}),
        },
      ],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(slowTool).tool(fastTool).build();
    const iterator = agent
      .prompt("call both")
      .withToolConcurrency(2)
      .stream()
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "tool_call",
      toolCall: AssistantContent.toolCall("call_slow", "slow_tool", {}),
    });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "tool_call",
      toolCall: AssistantContent.toolCall("call_fast", "fast_tool", {}),
    });
    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_end" });

    const firstToolResultPromise = iterator.next();
    await expect(slowStarted.promise).resolves.toBeUndefined();
    await expect(fastStarted.promise).resolves.toBeUndefined();

    const firstToolResult = await Promise.race([
      firstToolResultPromise,
      rejectAfter<IteratorResult<AgentStreamEvent>>(100, "Timed out waiting for fast tool result"),
    ]);
    expect(firstToolResult.done).toBe(false);
    if (firstToolResult.done) {
      throw new Error("Expected a tool result event");
    }
    expect(firstToolResult.value).toMatchObject({
      type: "tool_result",
      toolName: "fast_tool",
      result: "fast",
    });

    slowRelease.resolve();
    expect(await nextEvent(iterator)).toMatchObject({
      type: "tool_result",
      toolName: "slow_tool",
      result: "slow",
    });

    const remainingEvents = await collectIterator(iterator);
    expect(remainingEvents.at(-1)).toMatchObject({ type: "final", output: "done" });
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_slow",
          toolName: "slow_tool",
          content: [{ type: "text", text: "slow" }],
        },
        {
          type: "tool_result",
          id: "call_fast",
          toolName: "fast_tool",
          content: [{ type: "text", text: "fast" }],
        },
      ]),
    );
  });

  it("streams child agent events from streaming agent tools", async () => {
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
    const childAgent = new AgentBuilder("child", childModel).name("Child Agent").build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .build();

    const events = await collect(parentAgent.prompt("delegate").stream());
    const childEvents = events.filter((event) => event.type === "agent_tool_event");

    expect(childEvents.map((event) => event.event.type)).toEqual([
      "turn_start",
      "text_delta",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "agent_tool_event",
        turn: 1,
        toolName: "ask_child",
        internalCallId: expect.any(String),
        agentId: "child",
        agentName: "Child Agent",
        event: expect.objectContaining({ type: "text_delta", delta: "child " }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "ask_child",
        result: "child done",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", output: "parent done" });
  });

  it("streams child tool calls and child tool results from streaming agent tools", async () => {
    const parentModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "add" }),
        },
      ],
      [{ type: "text_delta", delta: "parent done" }],
    ]);
    const childModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_add", "add", { x: 2, y: 5 }),
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const childAgent = new AgentBuilder("child", childModel)
      .tool(addTool)
      .defaultMaxTurns(2)
      .build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .build();

    const events = await collect(parentAgent.prompt("delegate").stream());
    const childEvents = events.filter((event) => event.type === "agent_tool_event");

    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "agent_tool_event",
        event: expect.objectContaining({
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_add", "add", { x: 2, y: 5 }),
        }),
      }),
    );
    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "agent_tool_event",
        event: expect.objectContaining({
          type: "tool_result",
          toolName: "add",
          result: "7",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "ask_child",
        result: "7",
      }),
    );
  });

  it("persists streamed parent and child agent events to the event store", async () => {
    const eventStore = new RecordingEventStore();
    const parentModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "inspect" }),
        },
      ],
      [{ type: "text_delta", delta: "parent done" }],
    ]);
    const childModel = new StreamingQueueModel([[{ type: "text_delta", delta: "child done" }]]);
    const childAgent = new AgentBuilder("child", childModel).build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .eventStore(eventStore, { include: "all" })
      .build();

    const events = await collect(parentAgent.prompt("delegate").stream());
    const finalEvent = events.find(
      (event): event is Extract<AgentStreamEvent, { type: "final" }> => event.type === "final",
    );

    expect(eventStore.appendCalls).toHaveLength(events.length);
    expect(finalEvent).toMatchObject({ type: "final", runId: expect.any(String) });
    expect(eventStore.appendCalls.every((call) => call.runId === finalEvent?.runId)).toBe(true);
    expect(eventStore.appendCalls.some((call) => eventType(call.event) === "turn_start")).toBe(
      true,
    );
    expect(
      eventStore.appendCalls.some(
        (call) => eventType(call.event) === "agent_tool_event" && call.agentId === "child",
      ),
    ).toBe(true);
  });

  it("can persist only streamed child agent tool events", async () => {
    const eventStore = new RecordingEventStore();
    const parentModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "inspect" }),
        },
      ],
      [{ type: "text_delta", delta: "parent done" }],
    ]);
    const childModel = new StreamingQueueModel([[{ type: "text_delta", delta: "child done" }]]);
    const childAgent = new AgentBuilder("child", childModel).build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .eventStore(eventStore, { include: "agent_tool_events" })
      .build();

    await collect(parentAgent.prompt("delegate").stream());

    expect(eventStore.appendCalls.length).toBeGreaterThan(0);
    expect(
      eventStore.appendCalls.every((call) => eventType(call.event) === "agent_tool_event"),
    ).toBe(true);
  });

  it("buffers reasoning deltas without ids into one reasoning message", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "reasoning_delta", delta: "Think" },
        { type: "reasoning_delta", delta: " once." },
        { type: "text_delta", delta: "done" },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(agent.prompt("reason").stream());

    expect(events.at(-1)).toMatchObject({
      type: "final",
      messages: [
        Message.user("reason"),
        Message.assistant([
          AssistantContent.reasoning("Think once."),
          AssistantContent.text("done"),
        ]),
      ],
    });
  });

  it("buffers structured reasoning deltas by id and content type", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "reasoning_delta", id: "rs_1", delta: "Review", contentType: "summary" },
        { type: "reasoning_delta", id: "rs_1", delta: " complete.", contentType: "summary" },
        { type: "reasoning_delta", id: "rs_2", delta: "Step", contentType: "text" },
        {
          type: "reasoning_delta",
          id: "rs_2",
          delta: "",
          contentType: "text",
          signature: "sig_1",
        },
        { type: "reasoning_delta", id: "rs_3", delta: "opaque", contentType: "encrypted" },
        { type: "text_delta", delta: "done" },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(agent.prompt("reason").stream());

    expect(events).toContainEqual({
      type: "reasoning_delta",
      turn: 1,
      id: "rs_1",
      delta: "Review",
      contentType: "summary",
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      messages: [
        Message.user("reason"),
        Message.assistant([
          {
            type: "reasoning",
            id: "rs_1",
            text: "Review complete.",
            content: [{ type: "summary", text: "Review complete." }],
          },
          {
            type: "reasoning",
            id: "rs_2",
            text: "Step",
            content: [{ type: "text", text: "Step", signature: "sig_1" }],
          },
          {
            type: "reasoning",
            id: "rs_3",
            text: "",
            content: [{ type: "encrypted", data: "opaque" }],
          },
          AssistantContent.text("done"),
        ]),
      ],
    });
  });

  it("merges streamed tool-call chunks that use a provider call id", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "tool_0",
          callId: "call_1",
          name: "add",
        },
        {
          type: "tool_call_delta",
          id: "tool_0",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).build();

    const events = await collect(agent.prompt("add").stream());

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: {
        ...AssistantContent.toolCall("tool_0", "add", { x: 2, y: 5 }),
        callId: "call_1",
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        turn: 1,
        toolName: "add",
        toolCallId: "call_1",
        args: '{"x":2,"y":5}',
        result: "7",
      }),
    );
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "tool_0",
          callId: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("converts stream events to JSONL readable streams", async () => {
    async function* events() {
      yield { type: "text_delta", delta: "a" };
      yield { type: "final", output: "a" };
    }

    const readable = toReadableStream(events());
    const text = await readAll(readable);

    expect(
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { type: "text_delta", delta: "a" },
      { type: "final", output: "a" },
    ]);
  });

  it("emits an error JSON line when readable stream iteration fails", async () => {
    async function* events() {
      yield { type: "text_delta", delta: "a" };
      throw new Error("boom");
    }

    const text = await readAll(toReadableStream(events()));
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines[0]).toEqual({ type: "text_delta", delta: "a" });
    expect(lines[1]).toMatchObject({ type: "error", error: { message: "boom" } });
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

async function collectIterator<T>(iterator: AsyncIterator<T>): Promise<T[]> {
  const result: T[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return result;
    }
    result.push(next.value);
  }
}

async function nextEvent<T>(iterator: AsyncIterator<T>): Promise<T> {
  const next = await iterator.next();
  expect(next.done).toBe(false);
  if (next.done) {
    throw new Error("Expected another stream event");
  }
  return next.value;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function rejectAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function eventType(event: unknown): string | undefined {
  return typeof event === "object" && event !== null && "type" in event
    ? String(event.type)
    : undefined;
}

async function readAll(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return text;
    }
    text += decoder.decode(result.value, { stream: true });
  }
}
