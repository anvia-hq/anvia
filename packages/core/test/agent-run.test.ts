import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentRunCancelledError,
  AssistantContent,
  assertCompleted,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  cancelRun,
  createHook,
  createMiddleware,
  createTool,
  getAgentApprovalRequestDetails,
  MaxTurnsError,
  Message,
  requestToolApproval,
  type ToolCallContext,
  ToolOutput,
  Usage,
  withInternalAgentRunOptions,
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

type CompletionOutcome =
  | { response: CompletionResponse }
  | {
      error: unknown;
    };

class FlakyQueueModel implements CompletionModel {
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

  constructor(private readonly outcomes: CompletionOutcome[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      throw new Error("No queued outcome");
    }
    if ("error" in outcome) {
      throw outcome.error;
    }
    return outcome.response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

function textFromChoice(choice: CompletionResponse["choice"]): string {
  return choice
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
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

describe("Agent execution", () => {
  it("returns text-only completions", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new Agent({ id: "test-agent", model, instructions: "system" });

    const result = await agent.generate("hello");
    assertCompleted(result);

    expect(result.output).toBe("done");
    expect(model.requests[0]?.instructions).toBe("system");
    expect(model.requests[0]?.chatHistory[0]).toEqual(Message.user("hello"));
  });

  it("retries transient completion failures with the default policy", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("recovered")]) },
    ]);
    const agent = new Agent({ id: "test-agent", model });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const result = await agent.generate("hello", { retries: {} });
      assertCompleted(result);

      expect(result.output).toBe("recovered");
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]).toBe(model.requests[0]);
    } finally {
      random.mockRestore();
    }
  });

  it("inherits the Agent retry policy when a run does not override it", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("recovered")]) },
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(agent.generate("hello")).resolves.toMatchObject({
      status: "completed",
      output: "recovered",
    });
    expect(model.requests).toHaveLength(2);
  });

  it("disables inherited Agent retries for a run with retries false", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("unexpected")]) },
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(agent.generate("hello", { retries: false })).rejects.toBe(error);
    expect(model.requests).toHaveLength(1);
  });

  it("replaces rather than merges the Agent retry policy for one run", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("recovered")]) },
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      retries: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: () => false,
      },
    });

    await expect(
      agent.generate("hello", {
        retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).resolves.toMatchObject({ status: "completed", output: "recovered" });
    expect(model.requests).toHaveLength(2);
  });

  it("stops after the configured completion attempts and reports one logical error", async () => {
    const errors = [
      Object.assign(new Error("unavailable 1"), { status: 503 }),
      Object.assign(new Error("unavailable 2"), { status: 503 }),
      Object.assign(new Error("unavailable 3"), { status: 503 }),
    ];
    const model = new FlakyQueueModel(errors.map((error) => ({ error })));
    const hookCalls = { completionCall: 0, completionError: 0 };
    const hook = createHook({
      onCompletionCall() {
        hookCalls.completionCall += 1;
      },
      onCompletionError() {
        hookCalls.completionError += 1;
      },
    });
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate(
        "hello",
        withInternalAgentRunOptions({ retries: { initialDelayMs: 0, maxDelayMs: 0 } }, { hook }),
      ),
    ).rejects.toBe(errors[2]);

    expect(model.requests).toHaveLength(3);
    expect(hookCalls).toEqual({ completionCall: 1, completionError: 1 });
  });

  it("does not retry non-transient completion failures", async () => {
    const error = Object.assign(new Error("invalid request"), { status: 400 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("unexpected")]) },
    ]);
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", { retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    ).rejects.toBe(error);

    expect(model.requests).toHaveLength(1);
  });

  it("recognizes transient network codes through error causes", async () => {
    const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const error = new Error("provider connection failed", { cause });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("recovered")]) },
    ]);
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", { retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    ).resolves.toMatchObject({ output: "recovered" });

    expect(model.requests).toHaveLength(2);
  });

  it("never retries abort errors", async () => {
    const error = Object.assign(new Error("aborted"), { name: "AbortError", status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("unexpected")]) },
    ]);
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", { retries: { initialDelayMs: 0, maxDelayMs: 0 } }),
    ).rejects.toBe(error);

    expect(model.requests).toHaveLength(1);
  });

  it("supports request-specific completion retry classification", async () => {
    const error = new Error("warming up");
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("ready")]) },
    ]);
    const contexts: unknown[] = [];
    const agent = new Agent({ id: "test-agent", model });

    const result = await agent.generate("hello", {
      retries: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry(context) {
          contexts.push(context);
          return context.error === error;
        },
      },
    });
    assertCompleted(result);

    expect(result.output).toBe("ready");
    expect(contexts).toEqual([
      {
        error,
        attempt: 1,
        maxAttempts: 2,
        turn: 1,
        streaming: false,
      },
    ]);
  });

  it("validates completion retry options when configuring the request", () => {
    const agent = new Agent({
      id: "test-agent",
      model: new QueueModel([response([AssistantContent.text("unused")])]),
    });

    expect(() => agent.generate("hello", { retries: { maxAttempts: 0 } })).toThrow(RangeError);
    expect(() => agent.generate("hello", { retries: { maxAttempts: 1.5 } })).toThrow(RangeError);
    expect(() => agent.generate("hello", { retries: { initialDelayMs: -1 } })).toThrow(RangeError);
    expect(() =>
      agent.generate("hello", { retries: { initialDelayMs: 200, maxDelayMs: 100 } }),
    ).toThrow(RangeError);
    expect(() =>
      agent.generate("hello", {
        retries: { shouldRetry: true as unknown as () => boolean },
      }),
    ).toThrow(TypeError);
  });

  it("retries a later completion turn without replaying tools or request hooks", async () => {
    let toolExecutions = 0;
    let middlewareCalls = 0;
    let completionCalls = 0;
    let completionErrors = 0;
    const countingTool = createTool({
      name: "counted_add",
      description: "Add numbers and count executions",
      inputSchema: z.object({ x: z.number(), y: z.number() }),
      outputSchema: z.number(),
      execute: ({ x, y }) => {
        toolExecutions += 1;
        return x + y;
      },
    });
    const model = new FlakyQueueModel([
      {
        response: response([AssistantContent.toolCall("call_1", "counted_add", { x: 2, y: 5 })]),
      },
      { error: Object.assign(new Error("temporarily unavailable"), { status: 503 }) },
      { response: response([AssistantContent.text("7")]) },
    ]);
    const hook = createHook({
      onCompletionCall() {
        completionCalls += 1;
      },
      onCompletionError() {
        completionErrors += 1;
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [countingTool],
      middlewares: [
        createMiddleware({
          onCompletionRequest() {
            middlewareCalls += 1;
            return undefined;
          },
        }),
      ],
    });

    const result = await agent.generate(
      "add",
      withInternalAgentRunOptions({ retries: { initialDelayMs: 0, maxDelayMs: 0 } }, { hook }),
    );
    assertCompleted(result);

    expect(result.output).toBe("7");
    expect(model.requests).toHaveLength(3);
    expect(toolExecutions).toBe(1);
    expect(middlewareCalls).toBe(2);
    expect(completionCalls).toBe(2);
    expect(completionErrors).toBe(0);
    expect(result.messages.filter((message) => message.role === "tool")).toHaveLength(1);
  });

  it("passes complete configured instructions", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new Agent({
      id: "test-agent",
      model,
      instructions: "First block.\n\nSecond block.",
    });

    await agent.generate("hello");

    expect(model.requests[0]?.instructions).toBe("First block.\n\nSecond block.");
  });

  it("parses and preserves the type of schema-backed Agent output", async () => {
    const model = new QueueModel([response([AssistantContent.text('{"answer":"typed"}')])]);
    const agent = new Agent({
      id: "typed-agent",
      model,
      outputSchema: z.object({ answer: z.string() }),
    });

    const result = await agent.generate("answer");
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected a completed result.");
    expectTypeOf(result.output).toEqualTypeOf<{ answer: string }>();
    expect(result.output).toEqual({ answer: "typed" });
    expect(result.text).toBe('{"answer":"typed"}');
  });

  it("executes one tool round-trip", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    const result = await agent.generate("add");
    assertCompleted(result);

    expect(result.output).toBe("7");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.at(-2)?.role).toBe("assistant");
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          toolName: "add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("rejects empty completion tool names before dispatch", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("tool_0", "", { command: "pwd" }, "call_abc")]),
      response([AssistantContent.text("should not continue")]),
    ]);
    const agent = new Agent({ id: "test-agent", model });

    await expect(agent.generate("run a command")).rejects.toThrow(
      'Completion returned tool call "tool_0" with an empty function name; this indicates invalid provider output or provider mapping.',
    );
    expect(model.requests).toHaveLength(1);
  });

  it("executes multiple tool calls in one turn", async () => {
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 }),
        AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 }),
      ]),
      response([AssistantContent.text("ok")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    await expect(agent.generate("add twice", { toolConcurrency: 2 })).resolves.toMatchObject({
      output: "ok",
    });
    const finalToolMessage = model.requests[1]?.chatHistory.at(-1);
    expect(finalToolMessage?.role).toBe("tool");
    expect(finalToolMessage?.role === "tool" ? finalToolMessage.content : []).toHaveLength(2);
  });

  it("serializes tool calls when an internal hook is active", async () => {
    let active = 0;
    let maxActive = 0;
    const trackedTool = (name: string) =>
      createTool({
        name,
        description: name,
        inputSchema: z.object({}),
        async execute() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return name;
        },
      });
    const first = trackedTool("first");
    const second = trackedTool("second");
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "first", {}),
        AssistantContent.toolCall("call_2", "second", {}),
      ]),
      response([AssistantContent.text("done")]),
    ]);
    const hook = createHook({ onToolCall() {} });
    const agent = new Agent({ id: "test-agent", model, tools: [first, second] });

    await expect(
      agent.generate("run both", withInternalAgentRunOptions({ toolConcurrency: 2 }, { hook })),
    ).resolves.toMatchObject({ output: "done" });
    expect(maxActive).toBe(1);
  });

  it("validates run limits before starting an agent run", () => {
    const agent = new Agent({ id: "test-agent", model: new QueueModel([]) });

    expect(() => agent.generate("hi", { maxTurns: -1 })).toThrow(
      "maxTurns must be a nonnegative safe integer",
    );
    expect(() => agent.generate("hi", { toolConcurrency: 0 })).toThrow(
      "toolConcurrency must be a positive safe integer",
    );
    expect(() => agent.stream("hi", { toolConcurrency: Number.POSITIVE_INFINITY })).toThrow(
      "toolConcurrency must be a positive safe integer",
    );
  });

  it("uses an internal externally assigned run id consistently", async () => {
    const agent = new Agent({
      id: "test-agent",
      model: new QueueModel([response([AssistantContent.text("done")])]),
    });

    await expect(
      agent.generate("hi", withInternalAgentRunOptions({}, { runId: "external-run-id" })),
    ).resolves.toMatchObject({ runId: "external-run-id", output: "done" });
  });

  it("runs tool result middleware before hooks and the next model turn", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const outputGate = createMiddleware({
      onToolOutput({ toolName, result, originalResult, toolCallId }) {
        events.push(`${toolName}:${toolCallId}:${originalResult}`);
        return `stored:${result}`;
      },
    });
    const hook = createHook({
      onToolResult({ result }) {
        events.push(`hook:${result}`);
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [outputGate],
    });

    await expect(
      agent.generate("add", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(["add:fc_1:7", "hook:stored:7"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          toolName: "add",
          content: [{ type: "text", text: "stored:7" }],
        },
      ]),
    );
  });

  it("sends structured tool result content to the next model turn", async () => {
    const structuredContent = ToolOutput.content([
      { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
      { type: "image", data: "base64-png", mediaType: "image/png" },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      inputSchema: z.object({}),
      execute: () => structuredContent,
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "computer_screenshot", {}, "fc_1")]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onToolResult({ result, structuredResult }) {
        events.push(`${result}:${structuredResult?.length ?? 0}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [screenshotTool] });

    await expect(
      agent.generate("screenshot", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(['{"coordMap":"0,0,100,100,100,100"}\n[image:image/png]:2']);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          toolName: "computer_screenshot",
          content: structuredContent,
        },
      ]),
    );
  });

  it("lets middleware observe structured results and replace them with text", async () => {
    const structuredContent = ToolOutput.content([
      { type: "text", text: "screen" },
      { type: "image", data: "base64-png", mediaType: "image/png" },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      inputSchema: z.object({}),
      execute: () => structuredContent,
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "computer_screenshot", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const seen: string[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [screenshotTool],
      middlewares: [
        createMiddleware({
          onToolOutput({ result, structuredResult, originalStructuredResult }) {
            seen.push(
              `${result}:${structuredResult?.length ?? 0}:${originalStructuredResult?.length ?? 0}`,
            );
            return "stored:screenshot";
          },
        }),
      ],
    });

    await expect(agent.generate("screenshot")).resolves.toMatchObject({ output: "done" });

    expect(seen).toEqual(["screen\n[image:image/png]:2:2"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "computer_screenshot",
          content: [{ type: "text", text: "stored:screenshot" }],
        },
      ]),
    );
  });

  it("composes agent and request tool result middleware in order", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const keep = createMiddleware({
      onToolOutput({ result, originalResult }) {
        events.push(`keep:${result}:${originalResult}`);
        return undefined;
      },
    });
    const agentAppend = createMiddleware({
      onToolOutput({ result, originalResult }) {
        events.push(`agent:${result}:${originalResult}`);
        return `${result}:agent`;
      },
    });
    const requestAppend = createMiddleware({
      onToolOutput({ result, originalResult }) {
        events.push(`request:${result}:${originalResult}`);
        return `${result}:request`;
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [keep, agentAppend],
    });

    await expect(agent.generate("add", { middlewares: [requestAppend] })).resolves.toMatchObject({
      output: "done",
    });

    expect(events).toEqual(["keep:7:7", "agent:7:7", "request:7:agent:7"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7:agent:request" }],
        },
      ]),
    );
  });

  it("runs object-shaped hooks and continues when callbacks return nothing", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("7")]),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onCompletionCall({ prompt, history }) {
        events.push(`completion_call:${prompt.role}:${history.length}`);
      },
      onCompletionResponse({ response }) {
        events.push(`completion_response:${response.choice.length}`);
      },
      onToolCall({ toolName, toolCallId, args }) {
        events.push(`tool_call:${toolName}:${toolCallId}:${args}`);
      },
      onToolResult({ toolName, result }) {
        events.push(`tool_result:${toolName}:${result}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    await expect(
      agent.generate("add", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "7" });

    expect(events).toEqual([
      "completion_call:user:0",
      "completion_response:1",
      'tool_call:add:fc_1:{"x":2,"y":5}',
      "tool_result:add:7",
      "completion_call:tool:2",
      "completion_response:1",
    ]);
  });

  it("runs lifecycle hooks around prompt turns", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const events: string[] = [];
    const hook = createHook({
      onRunStart({ prompt, history, maxTurns }) {
        events.push(`run_start:${prompt.role}:${history.length}:${maxTurns}`);
      },
      onTurnStart({ turn, prompt, history }) {
        events.push(`turn_start:${turn}:${prompt.role}:${history.length}`);
      },
      onTurnEnd({ turn, response }) {
        events.push(`turn_end:${turn}:${response.choice.length}`);
      },
      onRunEnd({ output, messages }) {
        events.push(`run_end:${output}:${messages.length}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual([
      "run_start:user:0:20",
      "turn_start:1:user:0",
      "turn_end:1:1",
      "run_end:done:2",
    ]);
  });

  it("runs completion middleware before the model and before response hooks", async () => {
    const model = new QueueModel([response([AssistantContent.text("original")])]);
    const events: string[] = [];
    const hook = createHook({
      onCompletionResponse({ response }) {
        events.push(`hook:${textFromChoice(response.choice)}`);
      },
    });
    const agent = new Agent({
      id: "test-agent",
      model,
      middlewares: [
        createMiddleware({
          onCompletionRequest({ request, originalRequest }) {
            events.push(
              `request:${request.chatHistory.length}:${originalRequest.chatHistory.length}`,
            );
            return {
              request: {
                ...request,
                instructions: "middleware instructions",
              },
            };
          },
          onCompletionResponse({ response, originalResponse }) {
            events.push(
              `response:${textFromChoice(response.choice)}:${textFromChoice(originalResponse.choice)}`,
            );
            return {
              response: {
                ...response,
                choice: [AssistantContent.text("changed")],
              },
            };
          },
        }),
      ],
    });

    await expect(
      agent.generate("hello", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "changed" });

    expect(model.requests[0]?.instructions).toBe("middleware instructions");
    expect(events).toEqual(["request:1:1", "response:original:original", "hook:changed"]);
  });

  it("runs tool input and output middleware through the new API", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 1 })]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [
        createMiddleware({
          onToolInput({ args, originalArgs }) {
            events.push(`input:${args}:${originalArgs}`);
            return { args: { x: 2, y: 5 } };
          },
          onToolOutput({ result, originalResult, args }) {
            events.push(`output:${result}:${originalResult}:${args}`);
            return { result: `stored:${result}` };
          },
        }),
      ],
    });

    await expect(agent.generate("add")).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(['input:{"x":1,"y":1}:{"x":1,"y":1}', 'output:7:7:{"x":2,"y":5}']);
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

  it("composes agent and run middleware registrations in order", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      middlewares: [
        createMiddleware({
          onToolOutput({ result }) {
            return { result: `${result}:agent` };
          },
        }),
      ],
    });

    await expect(
      agent.generate("add", {
        middlewares: [
          ...[
            createMiddleware({
              onToolOutput({ result }) {
                return { result: `${result}:request` };
              },
            }),
          ],
          createMiddleware({
            onToolOutput({ result }) {
              return `${result}:legacy`;
            },
          }),
        ],
      }),
    ).resolves.toMatchObject({ output: "done" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7:agent:request:legacy" }],
        },
      ]),
    );
  });

  it("can run tool calls from a hook helper", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.run();
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    await expect(
      agent.generate("add", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "7" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("can skip tool calls from a hook helper", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("skipped")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.skip("not needed");
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [addTool] });

    await expect(
      agent.generate("add", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "skipped" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "not needed" }],
        },
      ]),
    );
  });

  it("can cancel prompts from a tool call hook helper before execution", async () => {
    let executed = false;
    const blockedTool = createTool({
      name: "blocked",
      description: "A tool that should not run",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "ran";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "blocked", {})]),
      response([AssistantContent.text("should not be requested")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.cancel("blocked");
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [blockedTool] });

    await expect(
      agent.generate("run blocked", withInternalAgentRunOptions({}, { hook })),
    ).rejects.toMatchObject({
      name: "AgentRunCancelledError",
      reason: "blocked",
    });
    expect(executed).toBe(false);
    expect(model.requests).toHaveLength(1);
  });

  it("suspends when an internal tool hook requests approval", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("should not be requested")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.requestApproval({ reason: "Guarded action." });
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    await expect(
      agent.generate("run guarded", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({
      status: "approval_required",
      approval: { toolName: "guarded", reason: "Guarded action." },
    });
    expect(executed).toBe(false);
    expect(model.requests).toHaveLength(1);
  });

  it("routes hook-based approval requests through the approval handler", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "approved result";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.requestApproval({ reason: "Guarded action." });
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const pending = await agent.generate("run guarded", withInternalAgentRunOptions({}, { hook }));
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      output: "done",
    });
    expect(executed).toBe(true);
  });

  it("skips hook-based approval requests when the approval handler rejects", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("denied")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.requestApproval({ rejectMessage: "Rejected by hook." });
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const pending = await agent.generate("run guarded", withInternalAgentRunOptions({}, { hook }));
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    await expect(agent.resume(pending, { approved: false })).resolves.toMatchObject({
      output: "denied",
    });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Rejected by hook." }],
        },
      ]),
    );
  });

  it("executes a tool after async approval-style hook allows it", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "approved result";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const hook = createHook({
      async onToolCall({ tool }) {
        const approved = await Promise.resolve(true);
        return approved ? tool.run() : tool.skip("not approved");
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    await expect(
      agent.generate("run guarded", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "approved result" }],
        },
      ]),
    );
  });

  it("skips a tool after async approval-style hook rejects it", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("denied")]),
    ]);
    const hook = createHook({
      async onToolCall({ tool }) {
        const approved = await Promise.resolve(false);
        return approved ? tool.run() : tool.skip("Rejected by policy.");
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    await expect(
      agent.generate("run guarded", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "denied" });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Rejected by policy." }],
        },
      ]),
    );
  });

  it("runs approval-protected tools after explicit approval", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ amount }) => (amount > 100 ? { reason: `Approve ${amount}` } : false),
      execute({ amount }) {
        executed = true;
        return `approved ${amount}`;
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 250 })]),
      response([AssistantContent.text("done")]),
    ]);
    const requests: unknown[] = [];
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    requests.push(getAgentApprovalRequestDetails(pending.approval));
    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      output: "done",
    });
    expect(executed).toBe(true);
    expect(requests).toMatchObject([
      {
        toolName: "guarded",
        args: { amount: 250 },
        reason: "Approve 250",
        run: { agentId: "test-agent" },
      },
    ]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "approved 250" }],
        },
      ]),
    );
  });

  it("approves and executes the exact same parsed tool input", async () => {
    let sequence = 0;
    let approvalInput: { generated: number } | undefined;
    let executedInput: { generated: number } | undefined;
    const baseGuardedTool = createTool({
      name: "guarded",
      description: "A guarded tool with a generated default",
      inputSchema: z.object({ generated: z.number().default(() => ++sequence) }),
      outputSchema: z.string(),
      requiresApproval(input) {
        approvalInput = input;
        return true;
      },
      execute(input) {
        executedInput = input;
        return `generated ${input.generated}`;
      },
    });
    let decoratedCalls = 0;
    const guardedTool = {
      ...baseGuardedTool,
      call(input: { generated: number }, context?: ToolCallContext) {
        decoratedCalls += 1;
        return baseGuardedTool.call(input, context === undefined ? undefined : { ...context });
      },
    };
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });
    const sequenceBeforeRun = sequence;

    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    expect(pending.approval.input).toEqual(approvalInput);
    expect(sequence).toBe(sequenceBeforeRun + 1);
    const approvedInput = approvalInput;

    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      status: "completed",
      output: "done",
    });
    expect(executedInput).toEqual(approvedInput);
    expect(sequence).toBe(sequenceBeforeRun + 1);
    expect(decoratedCalls).toBe(1);
  });

  it("isolates a pending approval snapshot from the suspended run state", async () => {
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute: () => "approved",
    });
    const toolResponse = response([AssistantContent.toolCall("call_1", "guarded", {})]);
    toolResponse.usage = {
      ...Usage.empty(),
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    };
    const model = new QueueModel([toolResponse, response([AssistantContent.text("done")])]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    pending.usage.totalTokens = 999;
    const pendingUser = pending.messages[0];
    if (pendingUser?.role === "user" && pendingUser.content[0]?.type === "text") {
      pendingUser.content[0].text = "mutated";
    }

    const result = await agent.resume(pending, { approved: true });
    if (result.status !== "completed") throw new Error("Expected completed result");
    expect(result.usage.totalTokens).toBe(5);
    expect(result.messages[0]).toEqual(Message.user("run guarded"));
  });

  it("returns invalid tool input to the model so it can recover", async () => {
    let executions = 0;
    const numberTool = createTool({
      name: "number_tool",
      description: "Accept a number",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.string(),
      execute() {
        executions += 1;
        return "ok";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "number_tool", { value: "invalid" })]),
      response([AssistantContent.text("recovered")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [numberTool] });

    await expect(agent.generate("run tool")).resolves.toMatchObject({
      status: "completed",
      output: "recovered",
    });
    expect(executions).toBe(0);
    expect(model.requests[1]?.chatHistory.at(-1)).toMatchObject({
      role: "tool",
      content: [
        expect.objectContaining({
          content: [expect.objectContaining({ text: expect.stringContaining("ToolCallError") })],
        }),
      ],
    });
  });

  it("fails closed when an approval callback returns an invalid value", async () => {
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      requiresApproval: (() => null) as never,
      execute: () => "never",
    });
    const model = new QueueModel([response([AssistantContent.toolCall("call_1", "guarded", {})])]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    await expect(agent.generate("run guarded")).rejects.toThrow(
      'Tool "requiresApproval" must be a boolean',
    );
  });

  it("evaluates tool approval after tool input middleware changes args", async () => {
    let executedAmount: number | undefined;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ amount }) => (amount > 100 ? { reason: `Approve ${amount}` } : false),
      execute({ amount }) {
        executedAmount = amount;
        return `approved ${amount}`;
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 50 })]),
      response([AssistantContent.text("done")]),
    ]);
    const approvalRequests: unknown[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [guardedTool],
      middlewares: [
        createMiddleware({
          onToolInput() {
            return { args: { amount: 250 } };
          },
        }),
      ],
    });

    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    approvalRequests.push(getAgentApprovalRequestDetails(pending.approval));
    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      output: "done",
    });

    expect(executedAmount).toBe(250);
    expect(approvalRequests).toMatchObject([
      {
        toolName: "guarded",
        args: { amount: 250 },
        rawArgs: '{"amount":250}',
        reason: "Approve 250",
      },
    ]);
  });

  it("skips approval-protected tools after explicit rejection", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ amount }) => amount > 100,
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 250 })]),
      response([AssistantContent.text("denied")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    await expect(agent.resume(pending, { approved: false })).resolves.toMatchObject({
      output: "denied",
    });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Tool approval was rejected." }],
        },
      ]),
    );
  });

  it("runs approval-protected tools directly when the condition is false", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ amount }) => amount > 100,
      execute() {
        executed = true;
        return "safe result";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 50 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });

    await expect(agent.generate("run guarded")).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
  });

  it("returns resumable approval state for new Agent instances", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      requiresApproval: true,
      execute() {
        executed = true;
        return "request approved";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });
    const pending = await agent.generate("run guarded");
    expect(pending).toMatchObject({
      status: "approval_required",
      approval: { toolName: "guarded", input: {} },
    });
    if (pending.status !== "approval_required") throw new Error("Expected approval");
    await expect(agent.resume(pending, { approved: true })).resolves.toMatchObject({
      status: "completed",
      output: "done",
    });
    expect(executed).toBe(true);
  });

  it("rejects resumable approvals without executing the tool", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      requiresApproval: true,
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("denied")]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [guardedTool] });
    const pending = await agent.generate("run guarded");
    if (pending.status !== "approval_required") throw new Error("Expected approval");

    const result = await agent.resume(pending, { approved: false, reason: "Not allowed." });
    expect(result).toMatchObject({ status: "completed", output: "denied" });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Not allowed." }],
        },
      ]),
    );
  });

  it("can cancel prompts from a hook helper", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const hook = createHook({
      onCompletionCall({ run }) {
        return run.cancel("blocked");
      },
    });
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", withInternalAgentRunOptions({}, { hook })),
    ).rejects.toBeInstanceOf(AgentRunCancelledError);
  });

  it("runs completion error hooks before run error hooks", async () => {
    const model = new QueueModel([]);
    const events: string[] = [];
    const hook = createHook({
      onCompletionError({ error }) {
        events.push(`completion_error:${error instanceof Error ? error.message : error}`);
      },
      onRunError({ error }) {
        events.push(`run_error:${error instanceof Error ? error.message : error}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model });

    await expect(
      agent.generate("hello", withInternalAgentRunOptions({}, { hook })),
    ).rejects.toThrow("No queued response");

    expect(events).toEqual(["completion_error:No queued response", "run_error:No queued response"]);
  });

  it("runs tool error hooks and keeps tool errors as model-visible results", async () => {
    const failingTool = createTool({
      name: "fail",
      description: "Fail",
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute() {
        throw new Error("tool failed");
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "fail", {})]),
      response([AssistantContent.text("handled")]),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onToolError({ toolName, error }) {
        events.push(`${toolName}:${error instanceof Error ? error.message : error}`);
      },
    });
    const agent = new Agent({ id: "test-agent", model, tools: [failingTool] });

    await expect(
      agent.generate("fail", withInternalAgentRunOptions({}, { hook })),
    ).resolves.toMatchObject({ output: "handled" });

    expect(events).toEqual(["fail:tool failed"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "fail",
          content: [{ type: "text", text: "ToolCallError: tool failed" }],
        },
      ]),
    );
  });

  it("keeps low-level hook action helpers available", () => {
    expect(cancelRun("blocked")).toEqual({ type: "terminate", reason: "blocked" });
    expect(requestToolApproval({ reason: "review" })).toEqual({
      type: "approval_request",
      reason: "review",
    });
  });

  it("composes agent and request lifecycle callbacks", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const events: string[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      lifecycle: {
        onStart() {
          events.push("agent:start");
        },
        onFinish() {
          events.push("agent:finish");
        },
      },
    });

    await agent.generate("hello", {
      lifecycle: {
        onStart() {
          events.push("run:start");
        },
        onFinish() {
          events.push("run:finish");
        },
      },
    });

    expect(events).toEqual(["agent:start", "run:start", "agent:finish", "run:finish"]);
  });

  it("isolates observational lifecycle callbacks from runtime state and each other", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const observed: string[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      lifecycle: {
        onStart(event) {
          const input = event.input as unknown as ReturnType<typeof Message.user>;
          const text = input.role === "user" ? input.content[0] : undefined;
          if (text?.type === "text") text.text = "mutated";
        },
        onStepFinish(event) {
          const mutable = event.response as unknown as CompletionResponse;
          mutable.choice.splice(0, mutable.choice.length, AssistantContent.text("mutated"));
        },
        onFinish(event) {
          (event.messages as unknown as Array<(typeof event.messages)[number]>).splice(0);
        },
      },
    });

    const result = await agent.generate("hello", {
      lifecycle: {
        onStart(event) {
          observed.push(
            event.input.role === "user" && event.input.content[0]?.type === "text"
              ? event.input.content[0].text
              : "missing",
          );
        },
        onStepFinish(event) {
          observed.push(textFromChoice(event.response.choice as CompletionResponse["choice"]));
        },
        onFinish(event) {
          observed.push(String(event.messages.length));
        },
      },
    });

    expect(observed).toEqual(["hello", "done", "2"]);
    expect(model.requests[0]?.chatHistory).toEqual([Message.user("hello")]);
    if (result.status !== "completed") throw new Error("Expected completed result");
    expect(result.output).toBe("done");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(Message.user("hello"));
    expect(result.messages.at(-1)).toMatchObject(Message.assistant("done"));
  });

  it("isolates lifecycle error callbacks from the reported error", async () => {
    const failure = new Error("provider failed");
    const agent = new Agent({
      id: "test-agent",
      model: new FlakyQueueModel([{ error: failure }]),
      lifecycle: {
        onError({ error }) {
          if (error instanceof Error) error.message = "mutated";
        },
      },
    });

    await expect(agent.generate("hello")).rejects.toThrow("provider failed");
    expect(failure.message).toBe("provider failed");
  });

  it("observes steps and successful tool execution through lifecycle callbacks", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const events: string[] = [];
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [addTool],
      lifecycle: {
        onStepFinish({ step }) {
          events.push(`step:${step}`);
        },
        onToolStart({ step, toolName, input }) {
          events.push(`tool_start:${step}:${toolName}:${JSON.stringify(input)}`);
        },
        onToolFinish(event) {
          events.push(
            event.success
              ? `tool_finish:${event.step}:${event.toolName}:${event.output}`
              : `tool_error:${event.step}:${event.toolName}`,
          );
        },
      },
    });

    await expect(agent.generate("add")).resolves.toMatchObject({
      status: "completed",
      output: "7",
    });
    expect(events).toEqual([
      "step:1",
      'tool_start:1:add:{"x":2,"y":5}',
      "tool_finish:1:add:7",
      "step:2",
    ]);
  });

  it("fails the run when a lifecycle callback throws", async () => {
    const failure = new Error("lifecycle failed");
    const observedErrors: unknown[] = [];
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new Agent({
      id: "test-agent",
      model,
      lifecycle: {
        onStepFinish() {
          throw failure;
        },
        onError({ error }) {
          observedErrors.push(error);
        },
      },
    });

    await expect(agent.generate("hello")).rejects.toBe(failure);
    expect(observedErrors).toEqual([failure]);
  });

  it("fails when the model keeps calling tools past max turns", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 })]),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [addTool], maxTurns: 0 });

    await expect(agent.generate("loop")).rejects.toBeInstanceOf(MaxTurnsError);
  });

  it("converts Zod output schemas into completion request JSON Schema", async () => {
    const model = new QueueModel([response([AssistantContent.text('{"title":"ok"}')])]);
    const agent = new Agent({
      id: "test-agent",
      model,
      outputSchema: z.object({ title: z.string() }).meta({ title: "summary_response" }),
    });

    await agent.generate("summarize");

    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
      title: "summary_response",
    });
  });
});
