import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  ActiveGenerationObservers,
  ActiveToolObservers,
  startAgentRunObservers,
} from "../src/observability/group";
import * as anvia from "./helpers/imports";
import {
  Agent,
  AgentRunCancelledError,
  type AgentGenerationEndArgs,
  type AgentGenerationErrorArgs,
  type AgentGenerationStartArgs,
  type AgentObserver,
  type AgentRunEndArgs,
  type AgentRunErrorArgs,
  type AgentRunEventArgs,
  type AgentRunObserver,
  type AgentRunPromptRef,
  type AgentRunStartArgs,
  type AgentToolEndArgs,
  type AgentToolErrorArgs,
  type AgentToolStartArgs,
  type AgentToolStreamEventArgs,
  type AgentToolSuspendedArgs,
  AssistantContent,
  assertCompleted,
  type CompletionModel,
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
  type CompletionResponse,
  createHook,
  createTool,
  type JsonObject,
  Message,
  type StreamingCompletionModel,
  skipTool,
  type ToolCall,
  Usage,
  withInternalAgentRunOptions,
} from "./helpers/imports";

// @ts-expect-error - Langfuse moved to @anvia/langfuse.
const removedLangfuseExport = anvia.langfuse;
void removedLangfuseExport;

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
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

  traceRequest(request: CompletionRequest): JsonObject {
    return {
      provider: this.provider,
      stream: false,
      modelId: this.modelId,
      messageCount: request.chatHistory.length,
    };
  }

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

  constructor(private readonly responses: CompletionModelStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  traceRequest(request: CompletionRequest, options: { stream?: boolean } = {}): JsonObject {
    return {
      provider: this.provider,
      stream: options.stream === true,
      modelId: this.modelId,
      messageCount: request.chatHistory.length,
    };
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    yield* response;
  }
}

class RecordingObserver implements AgentObserver {
  readonly events: unknown[] = [];

  startRun(args: AgentRunStartArgs): AgentRunObserver {
    this.events.push({ type: "run_start", args });
    return {
      trace: { traceId: "trace_1", observationId: "obs_1" },
      startGeneration: (generationArgs) => {
        this.events.push({ type: "generation_start", args: generationArgs });
        return {
          end: (endArgs: AgentGenerationEndArgs) => {
            this.events.push({ type: "generation_end", args: endArgs });
          },
          error: (errorArgs) => {
            this.events.push({ type: "generation_error", args: errorArgs });
          },
        };
      },
      startTool: (toolArgs) => {
        this.events.push({ type: "tool_start", args: toolArgs });
        return {
          end: (endArgs: AgentToolEndArgs) => {
            this.events.push({ type: "tool_end", args: endArgs });
          },
          suspend: (suspendArgs: AgentToolSuspendedArgs) => {
            this.events.push({ type: "tool_suspended", args: suspendArgs });
          },
          error: (errorArgs) => {
            this.events.push({ type: "tool_error", args: errorArgs });
          },
        };
      },
      end: (endArgs: AgentRunEndArgs) => {
        this.events.push({ type: "run_end", args: endArgs });
      },
      error: (errorArgs: AgentRunErrorArgs) => {
        this.events.push({ type: "run_error", args: errorArgs });
      },
      event: (eventArgs: AgentRunEventArgs) => {
        this.events.push({ type: "run_event", args: eventArgs });
      },
    };
  }
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

describe("agent observability", () => {
  it("records one run and one generation for text-only send", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });

    const result = await agent.generate({
      prompt: "hello",
      trace: {
        name: "test-run",
        userId: "user_1",
        metadata: { case: "text" },
        promptRef: { name: "support.system", version: 3 },
      },
    });
    assertCompleted(result);

    expect(result.trace).toEqual({
      observer: "test",
      traceId: "trace_1",
      observationId: "obs_1",
    });
    expect(result.runId).toEqual(expect.any(String));
    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "generation_end",
      "run_end",
    ]);
    expect(observer.events[0]).toMatchObject({
      args: {
        runId: result.runId,
        trace: {
          name: "test-run",
          userId: "user_1",
          metadata: { case: "text" },
          promptRef: { name: "support.system", version: 3 },
        },
        promptRef: { name: "support.system", version: 3 },
      },
    });
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "generation_start",
        args: expect.objectContaining({
          modelInfo: {
            provider: "test",
            modelId: "test",
            capabilities: expect.objectContaining({ streaming: false }),
          },
          providerRequest: expect.objectContaining({
            provider: "test",
            stream: false,
            modelId: "test",
            messageCount: 1,
          }),
        }),
      }),
    );
  });

  it("records recovered completion retries as sanitized run events", async () => {
    const observer = new RecordingObserver();
    const retryError = Object.assign(new Error("private provider detail"), {
      status: 503,
      code: "EAI_AGAIN",
    });
    const delegate = new QueueModel([response([AssistantContent.text("recovered")])]);
    let attempts = 0;
    const model: CompletionModel = {
      provider: delegate.provider,
      modelId: delegate.modelId,
      capabilities: delegate.capabilities,
      async completion(request) {
        attempts += 1;
        if (attempts === 1) {
          throw retryError;
        }
        return delegate.completion(request);
      },
    };
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });

    await expect(
      agent.generate({ prompt: "hello", retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    ).resolves.toMatchObject({ output: "recovered" });

    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "run_event",
      "generation_end",
      "run_end",
    ]);
    expect(observer.events[2]).toEqual({
      type: "run_event",
      args: {
        name: "completion.retry",
        level: "WARNING",
        attributes: {
          turn: 1,
          attempt: 1,
          nextAttempt: 2,
          maxAttempts: 3,
          delayMs: 0,
          streaming: false,
          errorName: "Error",
          statusCode: 503,
          errorCode: "EAI_AGAIN",
        },
      },
    });
    expect(JSON.stringify(observer.events[2])).not.toContain("private provider detail");
  });

  it("records provider-output retry classification and cumulative failed usage", async () => {
    const observer = new RecordingObserver();
    const failedUsage = {
      ...Usage.empty(),
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    };
    let attempts = 0;
    const model: CompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: new QueueModel([]).capabilities,
      async completion() {
        attempts += 1;
        if (attempts === 1) {
          throw new CompletionProviderOutputError({
            kind: "malformed-tool-arguments",
            toolCallId: "tool_0",
            usage: failedUsage,
          });
        }
        return response([AssistantContent.text("recovered")]);
      },
    };
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });

    await expect(
      agent.generate({
        prompt: "hello",
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).resolves.toMatchObject({ usage: { totalTokens: 10 } });

    const retry = observer.events.find(
      (event): event is { type: "run_event"; args: AgentRunEventArgs } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "run_event" &&
        "args" in event &&
        typeof event.args === "object" &&
        event.args !== null &&
        "name" in event.args &&
        event.args.name === "completion.retry",
    );
    expect(retry).toMatchObject({
      type: "run_event",
      args: {
        attributes: {
          errorName: "CompletionProviderOutputError",
          errorCode: "ANVIA_COMPLETION_PROVIDER_OUTPUT",
          providerOutputKind: "malformed-tool-arguments",
          attemptUsage: { totalTokens: 10 },
          cumulativeUsage: { totalTokens: 10 },
        },
      },
    });
    expect(JSON.stringify(retry)).not.toContain("tool_0");
  });

  it("records structured truncation retry diagnostics without response content", async () => {
    const observer = new RecordingObserver();
    const truncated = response([AssistantContent.text('{"answer":"private partial')]);
    truncated.finishReason = "length";
    truncated.providerFinishReason = "length";
    truncated.usage = {
      ...Usage.empty(),
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    const model = new QueueModel([
      truncated,
      response([AssistantContent.text('{"answer":"short"}')]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      outputSchema: z.object({ answer: z.string() }),
      observability: { observers: { test: observer }, primaryTrace: "test" },
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await agent.generate({ prompt: "hello" });

    const retry = observer.events.find(
      (event): event is { type: "run_event"; args: AgentRunEventArgs } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "run_event" &&
        "args" in event &&
        typeof event.args === "object" &&
        event.args !== null &&
        "name" in event.args &&
        event.args.name === "completion.retry",
    );
    expect(retry).toMatchObject({
      type: "run_event",
      args: {
        level: "WARNING",
        attributes: {
          attempt: 1,
          maxAttempts: 2,
          failurePhase: "truncated",
          finishReason: "length",
          providerFinishReason: "length",
          outputLength: 26,
          normalizedLength: 26,
          attemptUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          cumulativeUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          previousResponse: "omitted",
          includedOutputLength: 0,
        },
      },
    });
    expect(JSON.stringify(retry)).not.toContain("private partial");
  });

  it("records multiple turns and tool calls", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [addTool],
    });

    await expect(agent.generate({ prompt: "add" })).resolves.toMatchObject({ output: "7" });

    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "generation_end",
      "tool_start",
      "tool_end",
      "generation_start",
      "generation_end",
      "run_end",
    ]);
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "tool_start",
        args: expect.objectContaining({
          toolDefinition: expect.objectContaining({
            name: "add",
            description: "Add numbers",
          }),
          toolMetadata: expect.objectContaining({
            approvalRequired: false,
          }),
        }),
      }),
    );
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        args: expect.objectContaining({ result: "7", skipped: false }),
      }),
    );
  });

  it("records one error terminal event when a failed tool recovers through the model", async () => {
    const observer = new RecordingObserver();
    const failingTool = createTool({
      name: "fail",
      description: "Fail recoverably",
      inputSchema: z.object({}),
      execute() {
        throw new Error("tool failed");
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "fail", {})]),
      response([AssistantContent.text("handled")]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [failingTool],
    });

    await expect(agent.generate({ prompt: "fail" })).resolves.toMatchObject({ output: "handled" });

    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "generation_end",
      "tool_start",
      "tool_error",
      "generation_start",
      "generation_end",
      "run_end",
    ]);
    expect(
      eventTypes(observer).filter((type) => type === "tool_error" || type === "tool_end"),
    ).toHaveLength(1);
    expect(model.requests[1]?.chatHistory.at(-1)).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "fail",
          output: { type: "error-text", value: "ToolCallError: tool failed" },
        },
      ],
    });
  });

  it("records approval requests and decisions as structured run events", async () => {
    const observer = new RecordingObserver();
    const guardedTool = createTool({
      name: "guarded",
      description: "Guarded operation",
      inputSchema: z.object({ value: z.number() }),
      requiresApproval: { reason: "Review the operation" },
      execute: ({ value }) => String(value),
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { value: 7 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new anvia.Agent({
      id: "test-agent",
      model,
      tools: [guardedTool],
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });

    const pending = await agent.generate({ prompt: "run guarded" });
    if (pending.type !== "interaction") throw new Error("Expected suspension");
    expect(eventTypes(observer)).toContain("tool_start");
    expect(eventTypes(observer)).toContain("tool_suspended");
    expect(eventTypes(observer)).not.toContain("tool_error");
    expect(observer.events).toContainEqual({
      type: "run_end",
      args: expect.objectContaining({ status: "suspended", interaction: pending.interaction }),
    });
    await agent.generate({
      continuation: pending.continuation,
      response: { type: "tool-approval", approved: true, reason: "Reviewed" },
    });

    expect(observer.events).toContainEqual({
      type: "run_event",
      args: {
        name: "tool.approval_requested",
        attributes: expect.objectContaining({
          approvalId: pending.interaction.id,
          toolName: "guarded",
          reason: "Review the operation",
        }),
      },
    });
    expect(observer.events).toContainEqual({
      type: "run_event",
      args: {
        name: "tool.approval_resolved",
        attributes: expect.objectContaining({
          approvalId: pending.interaction.id,
          approved: true,
          decisionReason: "Reviewed",
        }),
      },
    });
  });

  it("records skipped tools from hooks", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("skipped")]),
    ]);
    const hook = createHook({
      onToolCall() {
        return skipTool("not allowed");
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [addTool],
    });

    await agent.generate({ prompt: "add", ...withInternalAgentRunOptions({}, { hook }) });

    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        args: expect.objectContaining({ result: "not allowed", skipped: true }),
      }),
    );
  });

  it("marks max-turn failures as run errors", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 })]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [addTool],
      maxTurns: 0,
    });

    await expect(agent.generate({ prompt: "loop" })).rejects.toThrow("Reached max turn limit");

    expect(eventTypes(observer).at(-1)).toBe("run_error");
  });

  it("records buffered streaming generation output and tool observations", async () => {
    const observer = new RecordingObserver();
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
        {
          type: "final",
          response: {
            ...response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
            finishReason: "tool-calls",
          },
        },
      ],
      [
        { type: "text_delta", delta: "he" },
        { type: "text_delta", delta: "llo" },
        successfulTextFinal("hello"),
      ],
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
      tools: [addTool],
    });

    const events = await collect(agent.stream({ prompt: "add" }));

    expect(events.at(-1)).toMatchObject({ type: "response", output: "hello" });
    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "generation_end",
      "tool_start",
      "tool_end",
      "generation_start",
      "generation_end",
      "run_end",
    ]);
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "generation_start",
        args: expect.objectContaining({
          modelInfo: {
            provider: "test",
            modelId: "test",
            capabilities: expect.objectContaining({ streaming: true }),
          },
          providerRequest: expect.objectContaining({
            provider: "test",
            stream: true,
            modelId: "test",
          }),
        }),
      }),
    );
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "generation_end",
        args: expect.objectContaining({
          firstDeltaMs: expect.any(Number),
          response: expect.objectContaining({
            choice: [AssistantContent.text("hello")],
          }),
        }),
      }),
    );
  });

  it("swallows observer failures by default and throws in strict mode", async () => {
    const observer: AgentObserver = {
      startRun() {
        throw new Error("observer failed");
      },
    };

    await expect(
      new Agent({
        id: "test-agent",
        model: new QueueModel([response([AssistantContent.text("ok")])]),
        observability: { observers: { test: observer }, primaryTrace: "test" },
      }).generate({ prompt: "hello" }),
    ).resolves.toMatchObject({ output: "ok" });

    await expect(
      new Agent({
        id: "test-agent",
        model: new QueueModel([response([AssistantContent.text("ok")])]),
        observability: {
          observers: { test: observer },
          primaryTrace: "test",
          errorPolicy: "throw",
        },
      }).generate({ prompt: "hello" }),
    ).rejects.toMatchObject({ name: "AgentObserverDispatchError", phase: "startRun" });
  });

  it("calls update on streaming observers once per delta", async () => {
    const updates: Array<{ turn: number; delta: { type: string; delta?: string } }> = [];
    const observer: AgentObserver = {
      startRun(): AgentRunObserver {
        return {
          startGeneration: () => ({
            update: (args) => {
              updates.push(args);
            },
            end: () => {},
          }),
          end: () => {},
        };
      },
    };
    const model = new StreamingQueueModel([
      [
        { type: "text_delta", delta: "he" },
        { type: "text_delta", delta: "llo" },
        successfulTextFinal("hello"),
      ],
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });
    await collect(agent.stream({ prompt: "hi" }));

    expect(updates).toEqual([
      { turn: 1, delta: { type: "text_delta", delta: "he" } },
      { turn: 1, delta: { type: "text_delta", delta: "llo" } },
    ]);
  });

  it("does not call update for non-streaming completions", async () => {
    const updates: unknown[] = [];
    const observer: AgentObserver = {
      startRun(): AgentRunObserver {
        return {
          startGeneration: () => ({
            update: (args) => {
              updates.push(args);
            },
            end: () => {},
          }),
          end: () => {},
        };
      },
    };
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });
    await agent.generate({ prompt: "hi" });
    expect(updates).toEqual([]);
  });

  it("honors observers that omit the optional update method", async () => {
    const observer: AgentObserver = {
      startRun(): AgentRunObserver {
        return {
          startGeneration: () => ({
            end: () => {},
          }),
          end: () => {},
        };
      },
    };
    const model = new StreamingQueueModel([
      [{ type: "text_delta", delta: "hi" }, successfulTextFinal("hi")],
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });
    await expect(collect(agent.stream({ prompt: "hi" }))).resolves.toBeDefined();
  });

  it.each([
    {
      boundary: "tool-call hook",
      hook: createHook({
        onToolCall() {
          throw new Error("tool-call hook failed");
        },
      }),
      middlewares: undefined,
    },
    {
      boundary: "tool-input middleware",
      hook: undefined,
      middlewares: [
        {
          onToolInput() {
            throw new Error("tool-input middleware failed");
          },
        },
      ],
    },
    {
      boundary: "tool-output middleware",
      hook: undefined,
      middlewares: [
        {
          onToolOutput() {
            throw new Error("tool-output middleware failed");
          },
        },
      ],
    },
    {
      boundary: "tool-result hook",
      hook: createHook({
        onToolResult() {
          throw new Error("tool-result hook failed");
        },
      }),
      middlewares: undefined,
    },
  ])(
    "terminalizes a started tool exactly once when the $boundary fails",
    async ({ hook, middlewares }) => {
      const observer = new RecordingObserver();
      const model = new QueueModel([
        response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      ]);
      const agent = new Agent({
        id: "test-agent",
        model,
        observability: { observers: { test: observer }, primaryTrace: "test" },
        tools: [addTool],
        middlewares: middlewares ?? [],
      });
      const runOptions = hook === undefined ? {} : withInternalAgentRunOptions({}, { hook });

      await expect(agent.generate({ prompt: "add", ...runOptions })).rejects.toThrow("failed");

      expect(
        eventTypes(observer).filter((type) => type === "tool_end" || type === "tool_error"),
      ).toEqual(["tool_error"]);
    },
  );

  it("preserves the model failure while every run-error cleanup callback fails", async () => {
    const primaryError = new Error("primary model failure");
    const cleanupCalls: string[] = [];
    const failingModel: CompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: new QueueModel([]).capabilities,
      async completion() {
        throw primaryError;
      },
    };
    const observer: AgentObserver = {
      startRun(): AgentRunObserver {
        return {
          startGeneration: () => ({
            end: () => {},
            error: () => {
              cleanupCalls.push("generation observer");
              throw new Error("generation observer failed");
            },
          }),
          end: () => {},
          error: () => {
            cleanupCalls.push("run observer");
            throw new Error("run observer failed");
          },
        };
      },
    };
    const hook = createHook({
      onCompletionError() {
        cleanupCalls.push("completion hook");
        throw new Error("completion hook failed");
      },
      onRunError() {
        cleanupCalls.push("run hook");
        throw new Error("run hook failed");
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model: failingModel,
      observability: { observers: { test: observer }, errorPolicy: "throw" },
    });

    await expect(
      agent.generate(
        withInternalAgentRunOptions(
          {
            prompt: "hello",
            lifecycle: {
              onError() {
                cleanupCalls.push("lifecycle");
                throw new Error("lifecycle failed");
              },
            },
          },
          { hook },
        ),
      ),
    ).rejects.toBe(primaryError);
    expect(cleanupCalls).toEqual([
      "generation observer",
      "completion hook",
      "run hook",
      "lifecycle",
      "run observer",
    ]);
  });

  it("reports failures terminated by the run-error hook as cancelled", async () => {
    const observer = new RecordingObserver();
    const hook = createHook({
      onRunError({ run }) {
        return run.cancel("stop after model failure");
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model: new QueueModel([]),
      observability: { observers: { test: observer }, primaryTrace: "test" },
    });

    let reportedError: unknown;
    try {
      await agent.generate({ prompt: "fail", ...withInternalAgentRunOptions({}, { hook }) });
    } catch (error) {
      reportedError = error;
    }

    expect(reportedError).toMatchObject({
      name: "AgentRunCancelledError",
      reason: "stop after model failure",
    });
    expect(reportedError).toBeInstanceOf(AgentRunCancelledError);
    const runErrorEvent = observer.events.find(
      (event) => (event as { type?: unknown }).type === "run_error",
    ) as { args: AgentRunErrorArgs } | undefined;
    expect(runErrorEvent?.args.status).toBe("cancelled");
    expect(runErrorEvent?.args.error).toMatchObject({
      reason: "stop after model failure",
    });
  });
});

describe("active agent observer groups", () => {
  it("exposes deeply readonly observer payload types", () => {
    expectTypeOf<AgentRunStartArgs["history"]>().toEqualTypeOf<
      Readonly<AgentRunStartArgs["history"]>
    >();
    expectTypeOf<AgentRunEndArgs["messages"]>().toEqualTypeOf<
      Readonly<AgentRunEndArgs["messages"]>
    >();
    expectTypeOf<AgentGenerationStartArgs["request"]["chatHistory"]>().toEqualTypeOf<
      Readonly<AgentGenerationStartArgs["request"]["chatHistory"]>
    >();
    expectTypeOf<AgentGenerationEndArgs["response"]["choice"]>().toEqualTypeOf<
      Readonly<AgentGenerationEndArgs["response"]["choice"]>
    >();
    expectTypeOf<AgentToolStartArgs["toolCall"]["input"]>().toEqualTypeOf<
      Readonly<AgentToolStartArgs["toolCall"]["input"]>
    >();
  });

  it("isolates run observer payloads from runtime values and sibling observers", async () => {
    const original = runStartArgs();
    const siblingStarts: AgentRunStartArgs[] = [];
    const siblingEnds: AgentRunEndArgs[] = [];
    const active = await startAgentRunObservers(
      {
        mutating: {
          startRun(args) {
            const mutable = args as unknown as {
              prompt: { content: Array<{ text?: string }> };
              history: unknown[];
            };
            mutable.prompt.content[0] = { text: "mutated" };
            mutable.history.push({ role: "user", content: [] });
            return createRunObserver({
              end(endArgs) {
                const mutableEnd = endArgs as unknown as {
                  messages: unknown[];
                  usage: { totalTokens: number };
                };
                mutableEnd.messages.splice(0);
                mutableEnd.usage.totalTokens = 99;
              },
            });
          },
        },
        sibling: {
          startRun(args) {
            siblingStarts.push(args);
            return createRunObserver({
              end(args) {
                siblingEnds.push(args);
              },
            });
          },
        },
      },
      original,
      { errorPolicy: "ignore" },
    );
    const endArgs: AgentRunEndArgs = {
      ...runEndArgs(),
      messages: [Message.user("hello"), Message.assistant("ok")],
    };

    await active.end(endArgs);

    expect(original.prompt).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
    expect(original.history).toEqual([]);
    expect(siblingStarts[0]?.prompt).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
    expect(siblingStarts[0]?.history).toEqual([]);
    expect(endArgs.messages).toHaveLength(2);
    expect(endArgs.usage.totalTokens).toBe(0);
    expect(siblingEnds[0]?.messages).toHaveLength(2);
    expect(siblingEnds[0]?.usage.totalTokens).toBe(0);
  });

  it("isolates generation payloads from model values and sibling observers", async () => {
    const siblingStarts: AgentGenerationStartArgs[] = [];
    const siblingEnds: AgentGenerationEndArgs[] = [];
    const active = await startAgentRunObservers(
      {
        mutating: {
          startRun: () =>
            createRunObserver({
              startGeneration(args) {
                const mutable = args as unknown as {
                  request: { chatHistory: unknown[]; documents: Array<{ text: string }> };
                };
                mutable.request.chatHistory.splice(0);
                const document = mutable.request.documents[0];
                if (document !== undefined) document.text = "mutated";
                return {
                  end(endArgs) {
                    const mutableEnd = endArgs as unknown as {
                      response: { choice: unknown[]; usage: { totalTokens: number } };
                    };
                    mutableEnd.response.choice.splice(0);
                    mutableEnd.response.usage.totalTokens = 99;
                  },
                };
              },
            }),
        },
        sibling: {
          startRun: () =>
            createRunObserver({
              startGeneration(args) {
                siblingStarts.push(args);
                return {
                  end(args) {
                    siblingEnds.push(args);
                  },
                };
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );
    const request: CompletionRequest = {
      chatHistory: [Message.user("hello")],
      documents: [{ id: "doc_1", text: "original" }],
      tools: [],
    };
    const generation = await active.startGeneration({ turn: 1, request });
    const completion = response([AssistantContent.text("ok")]);

    await generation.end({ turn: 1, response: completion });

    expect(request.chatHistory).toEqual([Message.user("hello")]);
    expect(request.documents[0]?.text).toBe("original");
    expect(siblingStarts[0]?.request.chatHistory).toEqual([Message.user("hello")]);
    expect(siblingStarts[0]?.request.documents[0]?.text).toBe("original");
    expect(completion.choice).toEqual([AssistantContent.text("ok")]);
    expect(completion.usage.totalTokens).toBe(0);
    expect(siblingEnds[0]?.response.choice).toEqual([AssistantContent.text("ok")]);
    expect(siblingEnds[0]?.response.usage.totalTokens).toBe(0);
  });

  it("isolates error, event, generation update, and tool payload fan-out", async () => {
    const siblingRunErrors: AgentRunErrorArgs[] = [];
    const siblingEvents: AgentRunEventArgs[] = [];
    const siblingGenerationErrors: AgentGenerationErrorArgs[] = [];
    const siblingUpdates: Array<{ delta: unknown }> = [];
    const siblingToolStarts: AgentToolStartArgs[] = [];
    const siblingToolEvents: AgentToolStreamEventArgs[] = [];
    const siblingToolEnds: AgentToolEndArgs[] = [];
    const siblingToolErrors: AgentToolErrorArgs[] = [];
    const mutatingRunObserver = createRunObserver({
      error(args) {
        (args.error as Error).message = "mutated";
        (args.messages as unknown[]).splice(0);
      },
      event(args) {
        const mutable = args.attributes as Record<string, unknown> | undefined;
        if (mutable !== undefined) mutable.label = "mutated";
      },
      startGeneration() {
        return {
          end() {},
          error(args) {
            (args.error as Error).message = "mutated";
          },
          update(args) {
            const mutable = args.delta as unknown as { toolCall: ToolCall };
            (mutable.toolCall as { input: JsonObject }).input = { value: "mutated" };
          },
        };
      },
      startTool(args) {
        (args.toolCall.input as Record<string, unknown>).value = "mutated";
        return {
          streamEvent(streamArgs) {
            const event = streamArgs.event.event as unknown as { chunk: string };
            event.chunk = "mutated";
          },
          end(endArgs) {
            (endArgs.structuredResult as unknown[] | undefined)?.splice(0);
          },
          error(errorArgs) {
            (errorArgs.error as Error).message = "mutated";
          },
        };
      },
    });
    const observingRunObserver = createRunObserver({
      error(args) {
        siblingRunErrors.push(args);
      },
      event(args) {
        siblingEvents.push(args);
      },
      startGeneration() {
        return {
          end() {},
          error(args) {
            siblingGenerationErrors.push(args);
          },
          update(args) {
            siblingUpdates.push(args);
          },
        };
      },
      startTool(args) {
        siblingToolStarts.push(args);
        return {
          streamEvent(args) {
            siblingToolEvents.push(args);
          },
          end(args) {
            siblingToolEnds.push(args);
          },
          error(args) {
            siblingToolErrors.push(args);
          },
        };
      },
    });
    const active = await startAgentRunObservers(
      {
        mutating: { startRun: () => mutatingRunObserver },
        sibling: { startRun: () => observingRunObserver },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );
    const runFailure = new Error("run failed");
    const runError = {
      ...runErrorArgs(),
      error: runFailure,
      messages: [Message.user("hello")],
    };
    const eventArgs: AgentRunEventArgs = { name: "custom", attributes: { label: "original" } };
    const generation = await active.startGeneration(generationStartArgs());
    const generationFailure = new Error("generation failed");
    const updateArgs = {
      turn: 1,
      delta: { type: "tool_call" as const, toolCall: toolCall() },
    };
    const startArgs = toolStartArgs();
    (startArgs.toolCall as { input: JsonObject }).input = { value: "original" };
    const streamTools = await active.startTool(startArgs);
    const endTools = await active.startTool(startArgs);
    const errorTools = await active.startTool(startArgs);
    const streamArgs = toolStreamEventArgs();
    const endArgs = {
      ...toolEndArgs(),
      structuredResult: [{ type: "text" as const, text: "3" }],
    };
    const toolFailure = new Error("tool failed");
    const errorArgs = { ...toolErrorArgs(), error: toolFailure };

    await active.error(runError);
    await active.event(eventArgs);
    await generation.error({ turn: 1, error: generationFailure });
    await generation.update(updateArgs);
    await streamTools.streamEvent(streamArgs);
    await endTools.end(endArgs);
    await errorTools.error(errorArgs);

    expect(runFailure.message).toBe("run failed");
    expect(runError.messages).toHaveLength(1);
    expect(siblingRunErrors[0]?.error).toMatchObject({ message: "run failed" });
    expect(siblingRunErrors[0]?.messages).toHaveLength(1);
    expect(eventArgs.attributes).toEqual({ label: "original" });
    expect(siblingEvents[0]?.attributes).toEqual({ label: "original" });
    expect(generationFailure.message).toBe("generation failed");
    expect(siblingGenerationErrors[0]?.error).toMatchObject({ message: "generation failed" });
    expect(updateArgs.delta.toolCall.input).toEqual({ x: 1, y: 2 });
    expect(siblingUpdates[0]?.delta).toMatchObject({
      toolCall: { input: { x: 1, y: 2 } },
    });
    expect(startArgs.toolCall.input).toEqual({ value: "original" });
    expect(siblingToolStarts).toHaveLength(3);
    expect(siblingToolStarts[0]?.toolCall.input).toEqual({ value: "original" });
    expect(streamArgs.event.event).toEqual({ chunk: '{"x":1' });
    expect(siblingToolEvents[0]?.event.event).toEqual({ chunk: '{"x":1' });
    expect(endArgs.structuredResult).toHaveLength(1);
    expect(siblingToolEnds[0]?.structuredResult).toHaveLength(1);
    expect(toolFailure.message).toBe("tool failed");
    expect(siblingToolErrors[0]?.error).toMatchObject({ message: "tool failed" });
  });

  it("skips undefined run observers and selects only the configured primary trace", async () => {
    const runObserver = createRunObserver({
      trace: { traceId: "trace_1", observationId: "obs_1" },
    });

    const active = await startAgentRunObservers(
      {
        empty: { startRun: () => undefined },
        traced: { startRun: () => runObserver },
      },
      runStartArgs(),
      { primaryTrace: "traced", errorPolicy: "ignore" },
    );

    expect(active.trace).toEqual({
      observer: "traced",
      traceId: "trace_1",
      observationId: "obs_1",
    });
  });

  it("collects named run observer failures according to the global policy", async () => {
    const error = new Error("start failed");
    const observers = {
      broken: {
        startRun() {
          throw error;
        },
      },
    };

    await expect(
      startAgentRunObservers(observers, runStartArgs(), { errorPolicy: "ignore" }),
    ).resolves.toMatchObject({
      trace: undefined,
    });
    await expect(
      startAgentRunObservers(observers, runStartArgs(), { errorPolicy: "throw" }),
    ).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "startRun",
      failures: [{ observer: "broken", error }],
    });
  });

  it("terminates observers that started before a strict run startup failure", async () => {
    const cleanup = vi.fn();
    await expect(
      startAgentRunObservers(
        {
          started: {
            startRun: () => createRunObserver({ error: cleanup }),
          },
          broken: {
            startRun: () => {
              throw new Error("startup failed");
            },
          },
        },
        runStartArgs(),
        { errorPolicy: "throw" },
      ),
    ).rejects.toMatchObject({ phase: "startRun" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("swallows nested observer failures in non-strict mode", async () => {
    const error = new Error("nested failed");
    const active = await startAgentRunObservers(
      {
        broken: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => {
                throw error;
              },
              startTool: () => {
                throw error;
              },
              end: () => {
                throw error;
              },
              error: () => {
                throw error;
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );

    await expect(active.startGeneration(generationStartArgs())).resolves.toBeInstanceOf(
      ActiveGenerationObservers,
    );
    await expect(active.startTool(toolStartArgs())).resolves.toBeInstanceOf(ActiveToolObservers);
    await expect(active.end(runEndArgs())).resolves.toBeUndefined();
    await expect(active.error(runErrorArgs())).resolves.toBeUndefined();
  });

  it("throws nested observer failures in strict mode", async () => {
    const error = new Error("strict failed");
    const active = await startAgentRunObservers(
      {
        broken: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => {
                throw error;
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "throw" },
    );

    await expect(active.startGeneration(generationStartArgs())).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "startGeneration",
    });
  });

  it("terminates nested observers that started before strict startup failures", async () => {
    const generationCleanup = vi.fn();
    const toolCleanup = vi.fn();
    const active = await startAgentRunObservers(
      {
        started: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => ({ end() {}, error: generationCleanup }),
              startTool: () => ({ end() {}, error: toolCleanup }),
            }),
        },
        broken: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => {
                throw new Error("generation startup failed");
              },
              startTool: () => {
                throw new Error("tool startup failed");
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "throw" },
    );

    await expect(active.startGeneration(generationStartArgs())).rejects.toMatchObject({
      phase: "startGeneration",
    });
    await expect(active.startTool(toolStartArgs())).rejects.toMatchObject({
      phase: "startTool",
    });
    expect(generationCleanup).toHaveBeenCalledOnce();
    expect(toolCleanup).toHaveBeenCalledOnce();
  });

  it("handles missing optional generation and tool observer methods", async () => {
    const active = await startAgentRunObservers(
      {
        partial: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => undefined,
              startTool: () => undefined,
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );

    const generationObservers = await active.startGeneration(generationStartArgs());
    const toolObservers = await active.startTool(toolStartArgs());

    await expect(generationObservers.error(generationErrorArgs())).resolves.toBeUndefined();
    await expect(toolObservers.streamEvent(toolStreamEventArgs())).resolves.toBeUndefined();
    await expect(toolObservers.error(toolErrorArgs())).resolves.toBeUndefined();
  });

  it("skips absent optional callbacks on active observers", async () => {
    const active = await startAgentRunObservers(
      {
        partial: {
          startRun: () =>
            createRunObserver({
              startGeneration: () => ({
                end() {},
              }),
              startTool: () => ({
                end() {},
              }),
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );

    const generationObservers = await active.startGeneration(generationStartArgs());
    const toolObservers = await active.startTool(toolStartArgs());

    await expect(active.error(runErrorArgs())).resolves.toBeUndefined();
    await expect(generationObservers.error(generationErrorArgs())).resolves.toBeUndefined();
    await expect(toolObservers.streamEvent(toolStreamEventArgs())).resolves.toBeUndefined();
    await expect(toolObservers.error(toolErrorArgs())).resolves.toBeUndefined();
  });

  it("applies strict handling inside generation and tool observer groups", async () => {
    const error = new Error("group failed");
    const generationError = vi.fn(() => {
      throw error;
    });
    const toolError = vi.fn(() => {
      throw error;
    });
    const generation = new ActiveGenerationObservers(
      [
        {
          name: "generation",
          terminal: false,
          observer: {
            end() {
              throw error;
            },
            error: generationError,
          },
        },
      ],
      "throw",
    );
    const tool = new ActiveToolObservers(
      [
        {
          name: "tool",
          terminal: false,
          observer: {
            streamEvent() {
              throw error;
            },
            end() {
              throw error;
            },
            error: toolError,
          },
        },
      ],
      "throw",
    );

    await expect(generation.end(generationEndArgs())).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "generation.end",
    });
    await expect(generation.error(generationErrorArgs())).resolves.toBeUndefined();
    await expect(tool.streamEvent(toolStreamEventArgs())).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "tool.streamEvent",
    });
    await expect(tool.end(toolEndArgs())).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "tool.end",
    });
    await expect(tool.error(toolErrorArgs())).resolves.toBeUndefined();
    expect(generationError).not.toHaveBeenCalled();
    expect(toolError).not.toHaveBeenCalled();
  });

  it("fans out run event() to observers that implement it", async () => {
    const seen: AgentRunEventArgs[] = [];
    const active = await startAgentRunObservers(
      {
        first: {
          startRun: () =>
            createRunObserver({
              event(args) {
                seen.push(args);
              },
            }),
        },
        second: {
          startRun: () =>
            createRunObserver({
              event(args) {
                seen.push(args);
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );

    const args: AgentRunEventArgs = {
      name: "retrieval.done",
      attributes: { docCount: 4 },
    };
    await expect(active.event(args)).resolves.toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(args);
    expect(seen[1]).toEqual(args);
  });

  it("skips run observers that omit event?", async () => {
    const active = await startAgentRunObservers(
      { test: { startRun: () => createRunObserver({}) } },
      runStartArgs(),
      { errorPolicy: "ignore" },
    );

    await expect(active.event({ name: "noop", attributes: { ok: true } })).resolves.toBeUndefined();
  });

  it("propagates named event errors under the throw policy", async () => {
    const error = new Error("event failed");
    const active = await startAgentRunObservers(
      {
        broken: {
          startRun: () =>
            createRunObserver({
              event() {
                throw error;
              },
            }),
        },
      },
      runStartArgs(),
      { errorPolicy: "throw" },
    );

    await expect(active.event({ name: "validation.passed" })).rejects.toMatchObject({
      name: "AgentObserverDispatchError",
      phase: "event",
      failures: [{ observer: "broken", error }],
    });
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

function successfulTextFinal(text: string): CompletionModelStreamEvent {
  return {
    type: "final",
    response: {
      ...response([AssistantContent.text(text)]),
      finishReason: "stop",
    },
  };
}

function createRunObserver(overrides: Partial<AgentRunObserver> = {}): AgentRunObserver {
  return {
    end() {},
    ...overrides,
  };
}

function runStartArgs(): AgentRunStartArgs {
  return {
    runId: "run_1",
    prompt: { role: "user", content: [{ type: "text", text: "hello" }] },
    history: [],
    maxTurns: 3,
  };
}

function runEndArgs(): AgentRunEndArgs {
  return {
    status: "completed",
    runId: "run_1",
    output: "ok",
    text: "ok",
    usage: Usage.empty(),
    messages: [],
  };
}

function runErrorArgs(): AgentRunErrorArgs {
  return {
    status: "failed",
    error: new Error("run failed"),
    usage: Usage.empty(),
    messages: [],
  };
}

function generationStartArgs(): AgentGenerationStartArgs {
  return {
    turn: 0,
    request: {
      chatHistory: [],
      documents: [],
      tools: [],
    },
  };
}

function generationEndArgs(): AgentGenerationEndArgs {
  return {
    turn: 0,
    response: response([AssistantContent.text("ok")]),
  };
}

function generationErrorArgs(): AgentGenerationErrorArgs {
  return {
    turn: 0,
    error: new Error("generation failed"),
  };
}

function toolStartArgs(): AgentToolStartArgs {
  return {
    turn: 0,
    toolCall: toolCall(),
    toolName: "add",
    args: '{"x":1,"y":2}',
    internalCallId: "internal_1",
    toolCallId: "call_1",
  };
}

function toolEndArgs(): AgentToolEndArgs {
  return {
    ...toolStartArgs(),
    result: "3",
    skipped: false,
  };
}

function toolErrorArgs(): AgentToolErrorArgs {
  return {
    ...toolStartArgs(),
    error: new Error("tool failed"),
  };
}

function toolStreamEventArgs(): AgentToolStreamEventArgs {
  return {
    ...toolStartArgs(),
    event: {
      agentId: "agent_1",
      event: { chunk: '{"x":1' },
    },
  };
}

function toolCall(): ToolCall {
  return {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "add",
    input: { x: 1, y: 2 },
  };
}

function eventTypes(observer: RecordingObserver): string[] {
  return observer.events.map((event) =>
    typeof event === "object" && event !== null && "type" in event ? String(event.type) : "",
  );
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

describe("AgentRunPromptRef", () => {
  it("is accepted on AgentRunStartArgs", () => {
    const promptRef: AgentRunPromptRef = { name: "support.system", version: 3 };
    const args: AgentRunStartArgs = {
      runId: "run_1",
      prompt: { role: "user", content: [{ type: "text", text: "hi" }] },
      history: [],
      maxTurns: 1,
      promptRef,
    };
    expect(args.promptRef?.name).toBe("support.system");
    expect(args.promptRef?.version).toBe(3);
  });
});
