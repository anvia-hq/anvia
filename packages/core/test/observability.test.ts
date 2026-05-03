import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as anvia from "../src/index";
import {
  AgentBuilder,
  type AgentGenerationEndArgs,
  type AgentObserver,
  type AgentRunEndArgs,
  type AgentRunErrorArgs,
  type AgentRunObserver,
  type AgentRunStartArgs,
  type AgentToolEndArgs,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createHook,
  createTool,
  type StreamingCompletionModel,
  skipTool,
  Usage,
} from "../src/index";

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
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
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
