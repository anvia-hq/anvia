import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  cancelPrompt,
  createHook,
  createTool,
  type MemoryAppendInput,
  type MemoryContext,
  type MemoryErrorInput,
  type MemoryStore,
  Message,
  type Message as MessageType,
  PromptCancelledError,
  type StreamingCompletionModel,
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
  private readonly sessions = new Map<string, MessageType[]>();

  constructor(initial: Record<string, MessageType[]> = {}) {
    for (const [sessionId, messages] of Object.entries(initial)) {
      this.sessions.set(sessionId, messages);
    }
  }

  async load(context: MemoryContext): Promise<MessageType[]> {
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

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
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

describe("agent memory", () => {
  it("uses prompt transcripts as stateless history", async () => {
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new AgentBuilder("test-agent", model).build();
    const transcript = [
      Message.user("My project is named Anvia."),
      Message.assistant("Noted."),
      Message.user("What is my project named?"),
    ];

    await agent.prompt(transcript).send();

    expect(model.requests[0]?.chatHistory).toEqual(transcript);
  });

  it("rejects empty prompt transcripts", async () => {
    const model = new QueueModel([]);
    const agent = new AgentBuilder("test-agent", model).build();

    expect(() => agent.prompt([])).toThrow("at least one message");
  });

  it("loads session messages before running", async () => {
    const previous = [Message.user("My project is named Anvia."), Message.assistant("Noted.")];
    const store = new RecordingMemoryStore({ session_1: previous });
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new AgentBuilder("test-agent", model).memory(store).build();

    await agent.session("session_1").prompt("What is my project named?").send();

    expect(model.requests[0]?.chatHistory).toEqual([
      ...previous,
      Message.user("What is my project named?"),
    ]);
  });

  it("saves messages incrementally by default", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).memory(store).tool(addTool).build();

    await agent.session("session_1").prompt("add").send();

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant"],
      ["tool"],
      ["assistant"],
    ]);
    await expect(agent.session("session_1").messages()).resolves.toHaveLength(4);
  });

  it("records failed runs after preserving completed messages", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
    ]);
    const agent = new AgentBuilder("test-agent", model).memory(store).tool(addTool).build();

    await expect(agent.session("session_1").prompt("add").send()).rejects.toThrow(
      "No queued response",
    );

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant"],
      ["tool"],
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
      input: z.object({}),
      execute: () => {
        probeExecutions += 1;
        return "probed";
      },
    });
    const execCommandTool = createTool({
      name: "ExecCommand",
      description: "Execute a command",
      input: z.object({ command: z.string() }),
      execute: () => {
        commandExecutions += 1;
        return "executed";
      },
    });
    const agent = new AgentBuilder("test-agent", model)
      .memory(store)
      .tool(probeTool)
      .tool(execCommandTool)
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
      for await (const _event of session.prompt("run tools").stream()) {
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

    for await (const _event of session.prompt("continue").stream()) {
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
    const agent = new AgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "turn" })
      .tool(addTool)
      .build();

    await agent.session("session_1").prompt("add").send();

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user", "assistant", "tool"],
      ["assistant"],
    ]);
  });

  it("supports run save policy", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "run" })
      .build();

    await agent.session("session_1").prompt("hello").send();

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user", "assistant"],
    ]);
  });

  it("does not commit run memory when the run end hook cancels", async () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model)
      .memory(store, { savePolicy: "run" })
      .hook(
        createHook({
          onRunEnd() {
            return cancelPrompt("blocked at end");
          },
        }),
      )
      .build();

    await expect(agent.session("session_1").prompt("hello").send()).rejects.toBeInstanceOf(
      PromptCancelledError,
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
    const childAgent = new AgentBuilder("child", childModel).build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .memory(store)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .build();

    for await (const _event of parentAgent.session("session_1").prompt("delegate").stream()) {
      // exhaust stream
    }

    expect(store.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant"],
      ["tool"],
      ["assistant"],
    ]);
    await expect(parentAgent.session("session_1").messages()).resolves.toHaveLength(4);
  });

  it("rejects transcript input for session prompts", () => {
    const store = new RecordingMemoryStore();
    const model = new QueueModel([]);
    const agent = new AgentBuilder("test-agent", model).memory(store).build();
    const prompt = agent.session("session_1").prompt as unknown as (
      input: MessageType[],
    ) => unknown;

    expect(() => prompt([Message.user("hello")])).toThrow("does not accept Message[]");
  });
});
