import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentRunCancelledError,
  type AgentRunErrorArgs,
  type AgentStream,
  AgentStreamClosedError,
  type AgentStreamEvent,
  AssistantContent,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  cancelRun,
  createHook,
  createMiddleware,
  createObserver,
  createTool,
  defineGuardrailPolicy,
  defineOutputGuardrail,
  getAssistantGenerationMetadata,
  Message,
  type StreamingCompletionModel,
  ToolOutput,
  toReadableStream,
  Usage,
  type UserMessage,
  withInternalAgentRunOptions,
} from "./helpers/imports";

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
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
      Iterable<CompletionModelStreamEvent> | AsyncIterable<CompletionModelStreamEvent>
    >,
  ) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
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
  events: CompletionModelStreamEvent[],
  error: unknown,
): AsyncIterable<CompletionModelStreamEvent> {
  yield* events;
  throw error;
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

describe("Agent streaming", () => {
  it("includes tool call deltas in the stream event type", () => {
    const model = new StreamingQueueModel([]);
    const agent = new Agent({ id: "test-agent", model });

    expectTypeOf(agent.stream({ prompt: "hi" })).toEqualTypeOf<AgentStream<AgentStreamEvent>>();
    expectTypeOf<Extract<AgentStreamEvent, { type: "tool_call_delta" }>>().not.toBeNever();
  });

  it("streams text deltas and final response", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "hel" },
        { type: "text_delta", delta: "lo" },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model, instructions: "system" });

    const events = await collect(agent.stream({ prompt: "hi" }));

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "generation_start",
      "text_delta",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "hello" } });
    expect(model.requests[0]?.instructions).toBe("system");
    expect(model.requests[0]?.chatHistory[0]).toEqual(Message.user("hi"));
  });

  it("cancels the run and closes the provider iterator when a consumer abandons a stream", async () => {
    let providerClosed = false;
    let runEnded = false;
    let runError: unknown;
    let generationError: unknown;
    const providerEvents = (async function* (): AsyncIterable<CompletionModelStreamEvent> {
      try {
        yield { type: "text_delta", delta: "partial" };
        yield { type: "text_delta", delta: "unread" };
      } finally {
        providerClosed = true;
      }
    })();
    const observer = createObserver({
      startRun() {
        return {
          startGeneration() {
            return {
              end() {},
              error({ error }) {
                generationError = error;
              },
            };
          },
          end() {
            runEnded = true;
          },
          error({ error }) {
            runError = error;
          },
        };
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model: new StreamingQueueModel([providerEvents]),
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });
    const stream = agent.stream({ prompt: "hi" });

    for await (const event of stream) {
      if (event.type === "text_delta") break;
    }

    expect(providerClosed).toBe(true);
    expect(runEnded).toBe(false);
    expect(runError).toBeInstanceOf(AgentRunCancelledError);
    expect(generationError).toBeInstanceOf(AgentRunCancelledError);
    expect(generationError).not.toBe(runError);
    expect(generationError).toMatchObject({
      message: (runError as Error).message,
      reason: (runError as AgentRunCancelledError).reason,
    });
    expect(() => stream.steer({ prompt: "too late" })).toThrow(AgentStreamClosedError);
  });

  it("measures first-delta latency from before generation_start is emitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    try {
      const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
      const agent = new Agent({ id: "test-agent", model });
      const iterator = agent.stream({ prompt: "hi" })[Symbol.asyncIterator]();

      expect((await iterator.next()).value).toMatchObject({ type: "turn_start" });
      expect((await iterator.next()).value).toMatchObject({ type: "generation_start" });
      vi.advanceTimersByTime(50);
      expect((await iterator.next()).value).toMatchObject({ type: "text_delta" });
      expect((await iterator.next()).value).toMatchObject({
        type: "turn_end",
        firstDeltaMs: 50,
      });
      expect((await iterator.next()).value).toMatchObject({ type: "final" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient stream failure before the first provider event", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([], error),
      [{ type: "text_delta", delta: "recovered" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(
      agent.stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "generation_start",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "recovered" } });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]).toBe(model.requests[0]);
  });

  it("retries an initial provider error event without exposing it", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { statusCode: 503 });
    const model = new StreamingQueueModel([
      [{ type: "error", error }],
      [{ type: "text_delta", delta: "ready" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(
      agent.stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    );

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "ready" } });
    expect(model.requests).toHaveLength(2);
  });

  it("includes authoritative failed-attempt usage exactly once after a retry succeeds", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const failedUsage = usage(4, 1);
    const successfulUsage = usage(6, 3);
    const model = new StreamingQueueModel([
      [{ type: "error", error, usage: failedUsage }],
      [
        {
          type: "final",
          response: completionResponse([AssistantContent.text("ready")], successfulUsage),
        },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(
      agent.stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        output: "ready",
        usage: Usage.add(failedUsage, successfulUsage),
      },
    });
    expect(model.requests).toHaveLength(2);
  });

  it("keeps successful final-event usage unchanged", async () => {
    const finalUsage = usage(5, 4);
    const model = new StreamingQueueModel([
      [
        {
          type: "final",
          response: completionResponse([AssistantContent.text("done")], finalUsage),
        },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "hi" }));

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: { output: "done", usage: finalUsage },
    });
  });

  it("includes authoritative provider failure usage exactly once", async () => {
    const error = new Error("provider failed");
    const providerUsage = usage(7, 2);
    const model = new StreamingQueueModel([[{ type: "error", error, usage: providerUsage }]]);
    const agent = new Agent({ id: "test-agent", model });
    const iterator = agent.stream({ prompt: "hi" })[Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent).toEqual({ type: "error", error, usage: providerUsage });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("uses empty usage when the first provider failure has no authoritative usage", async () => {
    const error = new Error("provider failed before usage");
    const model = new StreamingQueueModel([[{ type: "error", error }]]);
    const agent = new Agent({ id: "test-agent", model });
    const iterator = agent.stream({ prompt: "hi" })[Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent).toEqual({ type: "error", error, usage: Usage.empty() });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("retains completed turn usage when a later provider call fails before usage", async () => {
    const firstUsage = usage(8, 2);
    const error = new Error("second turn failed");
    const model = new StreamingQueueModel([
      [
        {
          type: "final",
          response: completionResponse(
            [AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })],
            firstUsage,
          ),
        },
      ],
      [{ type: "error", error }],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });
    const iterator = agent.stream({ prompt: "add" })[Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent.usage).toEqual(firstUsage);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("shares completed tool-turn usage with the observer and terminal error event", async () => {
    const turnUsage = usage(9, 3);
    let observedError: AgentRunErrorArgs | undefined;
    const observer = createObserver({
      startRun() {
        return {
          end() {},
          error(args) {
            observedError = args;
          },
        };
      },
    });
    const failingTool = createTool({
      name: "fail",
      description: "Fail",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        throw new Error("tool failed");
      },
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "final",
          response: completionResponse(
            [AssistantContent.toolCall("call_1", "fail", {})],
            turnUsage,
          ),
        },
      ],
    ]);
    const hook = createHook({
      onToolError() {
        return cancelRun("stop after tool failure");
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [failingTool],
    });
    const iterator = agent
      .stream({ prompt: "fail", ...withInternalAgentRunOptions({}, { hook }) })
      [Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent.usage).toEqual(turnUsage);
    expect(observedError?.usage).toEqual(errorEvent.usage);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("applies completion retries through readable agent streams", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([], error),
      [{ type: "text_delta", delta: "ready" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const text = await readAll(
      toReadableStream(
        agent.stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
      ),
    );
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "ready" } });
    expect(model.requests).toHaveLength(2);
  });

  it("serializes tool call deltas through readable agent streams by default", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
          argumentsMode: "replace",
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    const text = await readAll(toReadableStream(agent.stream({ prompt: "add" })));
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toContainEqual({
      type: "tool_call_delta",
      turn: 1,
      id: "call_1",
      name: "add",
      argumentsDelta: '{"x":2,"y":5}',
      argumentsMode: "replace",
    });
    expect(events.findIndex((event) => event.type === "tool_call_delta")).toBeLessThan(
      events.findIndex((event) => event.type === "tool_call"),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "7" } });
  });

  it("does not retry after a provider delta has been observed", async () => {
    const error = Object.assign(new Error("stream interrupted"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([{ type: "text_delta", delta: "partial" }], error),
      [{ type: "text_delta", delta: "duplicate" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });
    const iterator = agent
      .stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } })
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "generation_start",
      request: { chatHistory: [Message.user("hi")] },
      modelInfo: { provider: "test", modelId: "test" },
    });
    expect(await nextEvent(iterator)).toMatchObject({ type: "text_delta", delta: "partial" });
    expect(await nextEvent(iterator)).toEqual({ type: "error", error, usage: Usage.empty() });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(model.requests).toHaveLength(1);
  });

  it("does not retry after a non-emitted provider event has been observed", async () => {
    const error = Object.assign(new Error("stream interrupted"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([{ type: "message_id", id: "msg_1" }], error),
      [{ type: "text_delta", delta: "duplicate" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });
    const iterator = agent
      .stream({ prompt: "hi", retries: { initialDelayMs: 0, maxDelayMs: 0 } })
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toMatchObject({ type: "generation_start" });
    expect(await nextEvent(iterator)).toEqual({ type: "error", error, usage: Usage.empty() });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(model.requests).toHaveLength(1);
  });

  it("streams post-middleware response content when response middleware is registered", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "secret" }]]);
    const agent = new Agent({
      id: "test-agent",
      model,
      middlewares: [
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
      ],
    });

    const events = await collect(agent.stream({ prompt: "hi" }));
    const textDeltas = events
      .filter((event): event is Extract<AgentStreamEvent, { type: "text_delta" }> => {
        return event.type === "text_delta";
      })
      .map((event) => event.delta);

    expect(textDeltas).toEqual(["safe"]);
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "safe" } });
  });

  it("retains completed usage when the run end hook cancels before final", async () => {
    const finalUsage = usage(5, 2);
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "done" },
        { type: "final", response: completionResponse([], finalUsage) },
      ],
    ]);
    const hook = createHook({
      onRunEnd() {
        return cancelRun("blocked at end");
      },
    });
    const agent = new Agent({ id: "test-agent", model });
    const iterator = agent
      .stream({ prompt: "hi", ...withInternalAgentRunOptions({}, { hook }) })
      [Symbol.asyncIterator]();
    const events: AgentStreamEvent[] = [];

    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));
    events.push(await nextEvent(iterator));

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "generation_start",
      "text_delta",
      "turn_end",
      "error",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "error", usage: finalUsage });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("retains completed usage when an output guardrail fails", async () => {
    const finalUsage = usage(4, 2);
    const guardrailError = new Error("guardrail failed");
    const model = new StreamingQueueModel([
      [
        {
          type: "final",
          response: completionResponse([AssistantContent.text("done")], finalUsage),
        },
      ],
    ]);
    const outputGuardrail = defineOutputGuardrail({
      id: "failing-output",
      check() {
        throw guardrailError;
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      guardrails: defineGuardrailPolicy({ id: "policy", output: [outputGuardrail] }),
    });
    const iterator = agent.stream({ prompt: "hi" })[Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent).toEqual({ type: "error", error: guardrailError, usage: finalUsage });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("retains every completed turn usage when the max-turn limit fails the run", async () => {
    const firstUsage = usage(3, 1);
    const secondUsage = usage(6, 2);
    const model = new StreamingQueueModel([
      [
        {
          type: "final",
          response: completionResponse(
            [AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 })],
            firstUsage,
          ),
        },
      ],
      [
        {
          type: "final",
          response: completionResponse(
            [AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 })],
            secondUsage,
          ),
        },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool], maxTurns: 0 });
    const iterator = agent.stream({ prompt: "loop" })[Symbol.asyncIterator]();

    const errorEvent = await nextAgentError(iterator);

    expect(errorEvent.usage).toEqual(Usage.add(firstUsage, secondUsage));
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("rejects concurrent consumption of the same agent stream", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    const agent = new Agent({ id: "test-agent", model });
    const stream = agent.stream({ prompt: "hi" });
    const iterator = stream[Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    await expect(collect(stream)).rejects.toThrow("Agent stream is already running.");

    const rest = await collectIterator(iterator);
    expect(rest.at(-1)).toMatchObject({ type: "final", result: { output: "done" } });
  });

  it("accepts steering before consumption and rejects it after completion", async () => {
    const model = new StreamingQueueModel([
      [{ type: "text_delta", delta: "first" }],
      [{ type: "text_delta", delta: "second" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });
    const stream = agent.stream({ prompt: "hi" });

    const receipt = stream.steer({ prompt: "revise" });
    expect(receipt).toMatchObject({ status: "queued" });
    const events = await collect(stream);

    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "second" } });
    expect(() => stream.steer({ prompt: "late" })).toThrow(AgentStreamClosedError);
    await expect(collect(stream)).rejects.toThrow("Agent stream has already been consumed.");
  });

  it("closes steering before asynchronous terminal finalization begins", async () => {
    const finishStarted = deferred<void>();
    const finishRelease = deferred<void>();
    const stream = new Agent({
      id: "test-agent",
      model: new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]),
    }).stream({
      prompt: "hi",
      lifecycle: {
        async onFinish() {
          finishStarted.resolve();
          await finishRelease.promise;
        },
      },
    });

    const completion = collect(stream);
    await finishStarted.promise;
    expect(() => stream.steer({ prompt: "too late" })).toThrow(AgentStreamClosedError);
    finishRelease.resolve();
    await expect(completion).resolves.toContainEqual(
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({ output: "done" }),
      }),
    );
  });

  it("rejects steering after stream errors and cancellation", async () => {
    const errorStream = new Agent({
      id: "test-agent",
      model: new StreamingQueueModel([]),
    }).stream({ prompt: "hi" });
    const errorEvents = await collect(errorStream);
    expect(errorEvents.at(-1)).toMatchObject({
      type: "error",
      error: { message: "No queued response" },
    });
    expect(() => errorStream.steer({ prompt: "late" })).toThrow(AgentStreamClosedError);

    const hook = createHook({
      onRunStart() {
        return cancelRun("stop");
      },
    });
    const cancelledStream = new Agent({
      id: "test-agent",
      model: new StreamingQueueModel([]),
    }).stream({ prompt: "hi", ...withInternalAgentRunOptions({}, { hook }) });
    const cancelledEvents = await collect(cancelledStream);
    expect(cancelledEvents.at(-1)).toMatchObject({
      type: "error",
      error: expect.any(AgentRunCancelledError),
    });
    expect(() => cancelledStream.steer({ prompt: "late" })).toThrow(AgentStreamClosedError);
  });

  it("continues when steering arrives before a no-tool response finalizes", async () => {
    const model = new StreamingQueueModel([
      [{ type: "text_delta", delta: "first" }],
      [{ type: "text_delta", delta: "second" }],
    ]);
    const agent = new Agent({ id: "test-agent", model });
    const stream = agent.stream({ prompt: "hi" });
    const iterator = stream[Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({
      type: "turn_start",
      turn: 1,
      prompt: Message.user("hi"),
    });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "generation_start",
      turn: 1,
    });
    expect(await nextEvent(iterator)).toMatchObject({
      type: "text_delta",
      turn: 1,
      delta: "first",
    });
    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_end", turn: 1 });

    const receipt = stream.steer({ prompt: "revise" });
    expect(receipt).toMatchObject({ status: "queued" });

    const rest = await collectIterator(iterator);
    expect(rest.map((event) => event.type)).toEqual([
      "steering_applied",
      "turn_start",
      "generation_start",
      "text_delta",
      "turn_end",
      "final",
    ]);
    expect(rest[0]).toMatchObject({ type: "steering_applied", id: receipt.id, turn: 1 });
    expect(rest[1]).toMatchObject({
      type: "turn_start",
      turn: 2,
      prompt: Message.user("revise"),
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(Message.user("revise"));
    expect(rest.at(-1)).toMatchObject({
      type: "final",
      result: {
        output: "second",
        messages: [
          Message.user("hi"),
          Message.assistant("first"),
          Message.user("revise"),
          Message.assistant("second"),
        ],
      },
    });
  });

  it("appends steering after tool results before the next completion turn", async () => {
    const toolStarted = deferred<void>();
    const toolRelease = deferred<number>();
    const slowAddTool = createTool({
      name: "slow_add",
      description: "Add numbers slowly",
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
      }),
      outputSchema: z.number(),
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
    const agent = new Agent({ id: "test-agent", model, tools: [slowAddTool] });
    const stream = agent.stream({ prompt: "add" });
    const eventsPromise = collect(stream);

    await toolStarted.promise;
    expect(stream.steer({ prompt: "also explain" })).toMatchObject({ status: "queued" });
    toolRelease.resolve(7);

    const events = await eventsPromise;
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "done" } });
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
    const agent = new Agent({ id: "test-agent", model });
    const stream = agent.stream({ prompt: "start" });
    const iterator = stream[Symbol.asyncIterator]();
    const firstSteer = Message.user("first steer") as UserMessage;
    const secondSteer = Message.user("second steer") as UserMessage;

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "generation_start", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "text_delta", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_end", turn: 1 });

    const firstReceipt = stream.steer({ prompt: firstSteer });
    const secondReceipt = stream.steer({ messages: [secondSteer] });
    expect(firstReceipt).toMatchObject({ status: "queued" });
    expect(secondReceipt).toMatchObject({ status: "queued" });

    const rest = await collectIterator(iterator);
    expect(rest.slice(0, 2)).toMatchObject([
      { type: "steering_applied", id: firstReceipt.id, turn: 1 },
      { type: "steering_applied", id: secondReceipt.id, turn: 1 },
    ]);
    expect(rest[2]).toMatchObject({
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
      result: {
        messages: [
          Message.user("start"),
          Message.assistant("base"),
          firstSteer,
          secondSteer,
          Message.assistant("done"),
        ],
      },
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
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "hi" }));

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        output: "hello",
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        },
      },
    });
    const finalEvent = events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("Expected a final event");
    }
    const assistantMessage = finalEvent.result.messages.at(-1);
    expect(assistantMessage && getAssistantGenerationMetadata(assistantMessage)).toEqual({
      provider: "test",
      modelId: "test",
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
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    const events = await collect(agent.stream({ prompt: "add" }));

    expect(events).toContainEqual({
      type: "tool_call_delta",
      turn: 1,
      id: "call_1",
      name: "add",
      argumentsDelta: '{"x":2,"y":5}',
    });
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
    expect(events.findIndex((event) => event.type === "tool_call_delta")).toBeLessThan(
      events.findIndex((event) => event.type === "tool_call"),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "7" } });
    expect(model.requests).toHaveLength(2);
  });

  it("ends a stream segment for approval and resumes it exactly once", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "Run a guarded operation",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ value }) => ({ reason: `Approve ${value}` }),
      execute({ value }) {
        executed = true;
        return `approved ${value}`;
      },
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "guarded",
          argumentsDelta: '{"value":7}',
        },
      ],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const firstSegment = await collect(agent.stream({ prompt: "run guarded" }));
    const pending = firstSegment.at(-1);
    expect(pending).toMatchObject({
      type: "final",
      result: {
        status: "suspended",
        interaction: { type: "tool-approval", toolName: "guarded", input: { value: 7 } },
      },
    });
    expect(executed).toBe(false);
    if (pending?.type !== "final" || pending.result.status !== "suspended") {
      throw new Error("Expected suspended final event");
    }

    const resumed = await collect(
      agent.stream({
        continuation: pending.result.continuation,
        response: { type: "tool-approval", approved: true },
      }),
    );
    expect(executed).toBe(true);
    expect(resumed).toContainEqual(
      expect.objectContaining({ type: "tool_result", toolName: "guarded", result: "approved 7" }),
    );
    expect(resumed.at(-1)).toMatchObject({ type: "final", result: { output: "done" } });
    expect(resumed.at(-1)).toMatchObject({
      type: "final",
      result: { resumedFrom: { runId: pending.result.runId } },
    });
  });

  it("preserves accepted steering across a suspended stream boundary", async () => {
    const guardedTool = createTool({
      name: "guarded",
      description: "Run a guarded operation",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute: () => "approved",
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "guarded",
          argumentsDelta: "{}",
        },
      ],
      [{ type: "text_delta", delta: "prioritized" }],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });
    const stream = agent.stream({ prompt: "run guarded" });
    const iterator = stream[Symbol.asyncIterator]();
    const firstEvents: AgentStreamEvent[] = [];
    while (firstEvents.at(-1)?.type !== "turn_end") {
      firstEvents.push(await nextEvent(iterator));
    }
    const receipt = stream.steer({ prompt: "Prioritize this." });
    const rest = await collectIterator(iterator);
    const pending = rest.at(-1);
    if (pending?.type !== "final" || pending.result.status !== "suspended") {
      throw new Error("Expected suspended final event");
    }
    expect(() => stream.steer({ prompt: "too late" })).toThrow(AgentStreamClosedError);

    const resumed = await collect(
      agent.stream({
        continuation: pending.result.continuation,
        response: { type: "tool-approval", approved: true },
      }),
    );

    expect(resumed).toContainEqual({ type: "steering_applied", id: receipt.id, turn: 1 });
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(Message.user("Prioritize this."));
    expect(resumed.at(-1)).toMatchObject({
      type: "final",
      result: { status: "completed", output: "prioritized" },
    });
  });

  it("always emits provider tool call deltas", async () => {
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
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    const events = await collect(agent.stream({ prompt: "add" }));

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_delta" }));
    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "add",
        toolCallId: "call_1",
        result: "7",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "7" } });
  });

  it("emits tool call deltas by default before response middleware completes", async () => {
    let providerFinished = false;
    const firstTurn = (async function* (): AsyncIterable<CompletionModelStreamEvent> {
      yield {
        type: "tool_call_delta",
        id: "tool_1",
        callId: "call_1",
        name: "add",
        argumentsDelta: '{"x":2,"y":5}',
        signature: "signed",
      };
      providerFinished = true;
    })();
    const middlewareStarted = deferred<void>();
    const releaseMiddleware = deferred<void>();
    const model = new StreamingQueueModel([firstTurn, [{ type: "text_delta", delta: "7" }]]);
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [
        createMiddleware({
          async onCompletionResponse({ response }) {
            middlewareStarted.resolve();
            await releaseMiddleware.promise;
            return { response };
          },
        }),
      ],
    });
    const iterator = agent.stream({ prompt: "add" })[Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start", turn: 1 });
    expect(await nextEvent(iterator)).toMatchObject({ type: "generation_start", turn: 1 });
    expect(await nextEvent(iterator)).toEqual({
      type: "tool_call_delta",
      turn: 1,
      id: "tool_1",
      callId: "call_1",
      name: "add",
      argumentsDelta: '{"x":2,"y":5}',
      signature: "signed",
    });
    expect(providerFinished).toBe(false);

    const completedToolCall = iterator.next();
    await middlewareStarted.promise;
    let completedToolCallSettled = false;
    void completedToolCall.then(() => {
      completedToolCallSettled = true;
    });
    await Promise.resolve();
    expect(completedToolCallSettled).toBe(false);

    releaseMiddleware.resolve();
    await expect(completedToolCall).resolves.toMatchObject({
      done: false,
      value: {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("tool_1", "add", { x: 2, y: 5 }, "call_1"),
      },
    });
    expect(providerFinished).toBe(true);

    const remaining = await collectIterator(iterator);
    expect(remaining).toContainEqual(
      expect.objectContaining({ type: "tool_result", toolName: "add", result: "7" }),
    );
    expect(remaining.at(-1)).toMatchObject({ type: "final", result: { output: "7" } });
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
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [
        createMiddleware({
          onToolOutput({ result }) {
            return `stored:${result}`;
          },
        }),
      ],
    });

    const events = await collect(agent.stream({ prompt: "add" }));

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
      {
        type: "file",
        data: { type: "data", data: "iVBORw0KGgo=" },
        mediaType: "image/png",
      },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      inputSchema: z.object({}),
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
    const agent = new Agent({ id: "test-agent", model, tools: [screenshotTool] });

    const events = await collect(agent.stream({ prompt: "screenshot" }));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        turn: 1,
        toolName: "computer_screenshot",
        result: "screen\n[file:image/png]",
        structuredResult: structuredContent.content,
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
  });

  it("streams concurrent tool results as each tool finishes", async () => {
    const slowRelease = deferred<void>();
    const slowStarted = deferred<void>();
    const fastStarted = deferred<void>();
    const slowTool = createTool({
      name: "slow_tool",
      description: "Slow tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      requiresApproval: false,
      async execute() {
        slowStarted.resolve();
        await slowRelease.promise;
        return "slow";
      },
    });
    const fastTool = createTool({
      name: "fast_tool",
      description: "Fast tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      requiresApproval: false,
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
    const agent = new Agent({ id: "test-agent", model, tools: [slowTool, fastTool] });
    const iterator = agent
      .stream({ prompt: "call both", toolConcurrency: 2 })
      [Symbol.asyncIterator]();

    expect(await nextEvent(iterator)).toMatchObject({ type: "turn_start" });
    expect(await nextEvent(iterator)).toMatchObject({ type: "generation_start" });
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
    expect(remainingEvents.at(-1)).toMatchObject({ type: "final", result: { output: "done" } });
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
    const childAgent = new Agent({ id: "child", model: childModel, name: "Child Agent" });
    const parentAgent = new Agent({
      id: "parent",
      model: parentModel,
      tools: [childAgent.asTool({ name: "ask_child", stream: true, suspension: "reject" })],
    });

    const events = await collect(parentAgent.stream({ prompt: "delegate" }));
    const childEvents = events.filter((event) => event.type === "agent_tool_event");

    expect(childEvents.map((event) => event.event.type)).toEqual([
      "turn_start",
      "generation_start",
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
    expect(events.at(-1)).toMatchObject({ type: "final", result: { output: "parent done" } });
  });

  it("forwards child tool call deltas automatically", async () => {
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
          type: "tool_call_delta",
          id: "call_add",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const childAgent = new Agent({ id: "child", model: childModel, tools: [addTool], maxTurns: 2 });
    const parentAgent = new Agent({
      id: "parent",
      model: parentModel,
      tools: [childAgent.asTool({ name: "ask_child", stream: true, suspension: "reject" })],
    });

    const events = await collect(parentAgent.stream({ prompt: "delegate" }));
    const childEvents = events.filter((event) => event.type === "agent_tool_event");

    expect(childEvents.map((event) => eventType(event.event))).toContain("tool_call_delta");
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

  it("propagates tool call deltas through streaming agent tools by default", async () => {
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
          type: "tool_call_delta",
          id: "call_add",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const childAgent = new Agent({ id: "child", model: childModel, tools: [addTool], maxTurns: 2 });
    const parentAgent = new Agent({
      id: "parent",
      model: parentModel,
      tools: [childAgent.asTool({ name: "ask_child", stream: true, suspension: "reject" })],
    });

    const events = await collect(parentAgent.stream({ prompt: "delegate" }));
    const childEvents = events.filter((event) => event.type === "agent_tool_event");

    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "agent_tool_event",
        event: {
          type: "tool_call_delta",
          turn: 1,
          id: "call_add",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      }),
    );
    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: "agent_tool_event",
        event: expect.objectContaining({
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_add", "add", { x: 2, y: 5 }),
        }),
      }),
    );
  });

  it("buffers reasoning deltas without ids into one reasoning message", async () => {
    const model = new StreamingQueueModel([
      [
        { type: "reasoning_delta", delta: "Think" },
        { type: "reasoning_delta", delta: " once." },
        { type: "text_delta", delta: "done" },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "reason" }));

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        messages: [
          Message.user("reason"),
          Message.assistant([
            AssistantContent.reasoning("Think once."),
            AssistantContent.text("done"),
          ]),
        ],
      },
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
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "reason" }));

    expect(events).toContainEqual({
      type: "reasoning_delta",
      turn: 1,
      id: "rs_1",
      delta: "Review",
      contentType: "summary",
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        messages: [
          Message.user("reason"),
          Message.assistant([
            {
              type: "reasoning",
              id: "rs_1",
              text: "Review complete.",
              details: [{ type: "summary", text: "Review complete." }],
            },
            {
              type: "reasoning",
              id: "rs_2",
              text: "Step",
              details: [{ type: "text", text: "Step", signature: "sig_1" }],
            },
            {
              type: "reasoning",
              id: "rs_3",
              text: "",
              details: [{ type: "encrypted", data: "opaque" }],
            },
            AssistantContent.text("done"),
          ]),
        ],
      },
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
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    const events = await collect(agent.stream({ prompt: "add" }));

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
        toolCallId: "tool_0",
        callId: "call_1",
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
      yield { type: "final", result: { output: "a" } };
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
      { type: "final", result: { output: "a" } },
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

async function nextAgentError(
  iterator: AsyncIterator<AgentStreamEvent>,
): Promise<Extract<AgentStreamEvent, { type: "error" }>> {
  while (true) {
    const event = await nextEvent(iterator);
    if (event.type === "error") {
      return event;
    }
  }
}

function usage(inputTokens: number, outputTokens: number): ReturnType<typeof Usage.empty> {
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function completionResponse(
  choice: CompletionResponse["choice"],
  responseUsage: CompletionResponse["usage"],
): CompletionResponse {
  return {
    choice,
    usage: responseUsage,
    rawResponse: {},
  };
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
