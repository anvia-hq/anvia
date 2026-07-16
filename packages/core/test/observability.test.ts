import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ActiveGenerationObservers,
  ActiveToolObservers,
  startAgentRunObservers,
} from "../src/observability/group";
import * as anvia from "./helpers/imports";
import {
  AgentBuilder,
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
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createHook,
  createTool,
  type JsonObject,
  type StreamingCompletionModel,
  skipTool,
  type ToolCall,
  Usage,
} from "./helpers/imports";

// @ts-expect-error - Langfuse moved to @anvia/langfuse.
const removedLangfuseExport = anvia.langfuse;
void removedLangfuseExport;

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

  traceRequest(request: CompletionRequest): JsonObject {
    return {
      provider: this.provider,
      stream: false,
      model: request.model ?? this.defaultModel,
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

  traceRequest(request: CompletionRequest, options: { stream?: boolean } = {}): JsonObject {
    return {
      provider: this.provider,
      stream: options.stream === true,
      model: request.model ?? this.defaultModel,
      messageCount: request.chatHistory.length,
    };
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
  input: z.object({
    x: z.number(),
    y: z.number(),
  }),
  output: z.number(),
  execute: (args) => args.x + args.y,
});

describe("agent observability", () => {
  it("records one run and one generation for text-only send", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model).observe(observer).build();

    const result = await agent
      .prompt("hello")
      .withTrace({ name: "test-run", userId: "user_1", metadata: { case: "text" } })
      .send();

    expect(result.trace).toEqual({ traceId: "trace_1", observationId: "obs_1" });
    expect(eventTypes(observer)).toEqual([
      "run_start",
      "generation_start",
      "generation_end",
      "run_end",
    ]);
    expect(observer.events[0]).toMatchObject({
      args: {
        trace: {
          name: "test-run",
          userId: "user_1",
          metadata: { case: "text" },
        },
      },
    });
    expect(observer.events).toContainEqual(
      expect.objectContaining({
        type: "generation_start",
        args: expect.objectContaining({
          modelInfo: {
            provider: "test",
            defaultModel: "test",
            capabilities: expect.objectContaining({ streaming: false }),
          },
          providerRequest: expect.objectContaining({
            provider: "test",
            stream: false,
            model: "test",
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
      defaultModel: delegate.defaultModel,
      capabilities: delegate.capabilities,
      async completion(request) {
        attempts += 1;
        if (attempts === 1) {
          throw retryError;
        }
        return delegate.completion(request);
      },
    };
    const agent = new AgentBuilder("test-agent", model).observe(observer).build();

    await expect(
      agent.prompt("hello").withCompletionRetries({ initialDelayMs: 0, maxDelayMs: 0 }).send(),
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

  it("records multiple turns and tool calls", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).observe(observer).tool(addTool).build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "7" });

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

  it("records skipped tools from hooks", async () => {
    const observer = new RecordingObserver();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("skipped")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .observe(observer)
      .tool(addTool)
      .hook(
        createHook({
          onToolCall() {
            return skipTool("not allowed");
          },
        }),
      )
      .build();

    await agent.prompt("add").send();

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
    const agent = new AgentBuilder("test-agent", model)
      .observe(observer)
      .tool(addTool)
      .defaultMaxTurns(0)
      .build();

    await expect(agent.prompt("loop").send()).rejects.toThrow("Reached max turn limit");

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
      ],
      [
        { type: "text_delta", delta: "he" },
        { type: "text_delta", delta: "llo" },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).observe(observer).tool(addTool).build();

    const events = await collect(agent.prompt("add").stream());

    expect(events.at(-1)).toMatchObject({ type: "final", output: "hello" });
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
            defaultModel: "test",
            capabilities: expect.objectContaining({ streaming: true }),
          },
          providerRequest: expect.objectContaining({
            provider: "test",
            stream: true,
            model: "test",
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
      new AgentBuilder("test-agent", new QueueModel([response([AssistantContent.text("ok")])]))
        .observe(observer)
        .build()
        .prompt("hello")
        .send(),
    ).resolves.toMatchObject({ output: "ok" });

    await expect(
      new AgentBuilder("test-agent", new QueueModel([response([AssistantContent.text("ok")])]))
        .observe(observer)
        .build()
        .prompt("hello")
        .withTrace({ failOnObserverError: true })
        .send(),
    ).rejects.toThrow("observer failed");
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
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).observe(observer).build();
    await collect(agent.prompt("hi").stream());

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
    const agent = new AgentBuilder("test-agent", model).observe(observer).build();
    await agent.prompt("hi").send();
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
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hi" }]]);
    const agent = new AgentBuilder("test-agent", model).observe(observer).build();
    await expect(collect(agent.prompt("hi").stream())).resolves.toBeDefined();
  });
});

describe("active agent observer groups", () => {
  it("skips undefined run observers and selects the first available trace", async () => {
    const runObserver = createRunObserver({
      trace: { traceId: "trace_1", observationId: "obs_1" },
    });

    const active = await startAgentRunObservers(
      [{ observer: { startRun: () => undefined } }, { observer: { startRun: () => runObserver } }],
      runStartArgs(),
      false,
    );

    expect(active.trace).toEqual({ traceId: "trace_1", observationId: "obs_1" });
  });

  it("swallows run observer start failures unless global or registration strict mode is enabled", async () => {
    const error = new Error("start failed");
    const registration = {
      observer: {
        startRun() {
          throw error;
        },
      },
    };

    await expect(
      startAgentRunObservers([registration], runStartArgs(), false),
    ).resolves.toMatchObject({
      trace: undefined,
    });
    await expect(startAgentRunObservers([registration], runStartArgs(), true)).rejects.toThrow(
      error,
    );
    await expect(
      startAgentRunObservers(
        [{ ...registration, failOnObserverError: true }],
        runStartArgs(),
        false,
      ),
    ).rejects.toThrow(error);
  });

  it("swallows nested observer failures in non-strict mode", async () => {
    const error = new Error("nested failed");
    const active = await startAgentRunObservers(
      [
        {
          observer: {
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
      ],
      runStartArgs(),
      false,
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
      [
        {
          observer: {
            startRun: () =>
              createRunObserver({
                startGeneration: () => {
                  throw error;
                },
              }),
          },
        },
      ],
      runStartArgs(),
      true,
    );

    await expect(active.startGeneration(generationStartArgs())).rejects.toThrow(error);
  });

  it("handles missing optional generation and tool observer methods", async () => {
    const active = await startAgentRunObservers(
      [
        {
          observer: {
            startRun: () =>
              createRunObserver({
                startGeneration: () => undefined,
                startTool: () => undefined,
              }),
          },
        },
      ],
      runStartArgs(),
      false,
    );

    const generationObservers = await active.startGeneration(generationStartArgs());
    const toolObservers = await active.startTool(toolStartArgs());

    await expect(generationObservers.error(generationErrorArgs())).resolves.toBeUndefined();
    await expect(toolObservers.streamEvent(toolStreamEventArgs())).resolves.toBeUndefined();
    await expect(toolObservers.error(toolErrorArgs())).resolves.toBeUndefined();
  });

  it("skips absent optional callbacks on active observers", async () => {
    const active = await startAgentRunObservers(
      [
        {
          observer: {
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
      ],
      runStartArgs(),
      false,
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
    const generation = new ActiveGenerationObservers(
      [
        {
          end() {
            throw error;
          },
          error() {
            throw error;
          },
        },
      ],
      true,
    );
    const tool = new ActiveToolObservers(
      [
        {
          streamEvent() {
            throw error;
          },
          end() {
            throw error;
          },
          error() {
            throw error;
          },
        },
      ],
      true,
    );

    await expect(generation.end(generationEndArgs())).rejects.toThrow(error);
    await expect(generation.error(generationErrorArgs())).rejects.toThrow(error);
    await expect(tool.streamEvent(toolStreamEventArgs())).rejects.toThrow(error);
    await expect(tool.end(toolEndArgs())).rejects.toThrow(error);
    await expect(tool.error(toolErrorArgs())).rejects.toThrow(error);
  });

  it("fans out run event() to observers that implement it", async () => {
    const seen: AgentRunEventArgs[] = [];
    const active = await startAgentRunObservers(
      [
        {
          observer: {
            startRun: () =>
              createRunObserver({
                event(args) {
                  seen.push(args);
                },
              }),
          },
        },
        {
          observer: {
            startRun: () =>
              createRunObserver({
                event(args) {
                  seen.push(args);
                },
              }),
          },
        },
      ],
      runStartArgs(),
      false,
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
      [
        {
          observer: {
            startRun: () => createRunObserver({}),
          },
        },
      ],
      runStartArgs(),
      false,
    );

    await expect(active.event({ name: "noop", attributes: { ok: true } })).resolves.toBeUndefined();
  });

  it("propagates event errors when failOnObserverError is set", async () => {
    const error = new Error("event failed");
    const active = await startAgentRunObservers(
      [
        {
          observer: {
            startRun: () =>
              createRunObserver({
                event() {
                  throw error;
                },
              }),
          },
          failOnObserverError: true,
        },
      ],
      runStartArgs(),
      true,
    );

    await expect(active.event({ name: "validation.passed" })).rejects.toThrow(error);
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
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
    prompt: { role: "user", content: [{ type: "text", text: "hello" }] },
    history: [],
    maxTurns: 3,
  };
}

function runEndArgs(): AgentRunEndArgs {
  return {
    output: "ok",
    usage: Usage.empty(),
    messages: [],
  };
}

function runErrorArgs(): AgentRunErrorArgs {
  return {
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
    type: "tool_call",
    id: "call_1",
    function: {
      name: "add",
      arguments: { x: 1, y: 2 },
    },
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
      prompt: { role: "user", content: [{ type: "text", text: "hi" }] },
      history: [],
      maxTurns: 1,
      promptRef,
    };
    expect(args.promptRef?.name).toBe("support.system");
    expect(args.promptRef?.version).toBe(3);
  });
});
