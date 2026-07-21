import { AgentBuilder, type Tool } from "@anvia/core";
import {
  AssistantContent,
  type CompletionRequest,
  type CompletionStreamEvent,
  Message,
  ToolContent,
  UserContent,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { OpenAIChatCompletionModel, OpenAIClient } from "../src/index";
import {
  fromOpenAIChatCompletionResponse,
  fromOpenAIChatCompletionStreamChunk,
  toOpenAIChatCompletionParams,
} from "../src/openai/chat-completion";

const INVALID_TOOL_INDEX_ERROR =
  "OpenAI Chat Completions stream returned a tool call with an invalid index; expected a finite nonnegative integer.";
const AMBIGUOUS_CHOICE_ERROR =
  "OpenAI Chat Completions stream returned ambiguous completion choices without valid indices; provider output cannot be assembled safely.";
const MISSING_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream ended without a terminal finish reason; provider output may be incomplete.";
const LENGTH_TOOL_FINISH_ERROR =
  'OpenAI Chat Completions tool-call stream ended with finish_reason "length"; provider output may be incomplete.';
const CONTENT_FILTER_TOOL_FINISH_ERROR =
  'OpenAI Chat Completions tool-call stream ended with finish_reason "content_filter"; tool calls will not be executed.';
const UNSUPPORTED_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream ended with an unsupported finish reason; provider output cannot be assembled safely.";
const CONFLICTING_TOOL_FINISH_ERROR =
  "OpenAI Chat Completions tool-call stream returned conflicting terminal finish reasons; provider output cannot be assembled safely.";

describe("OpenAI chat-completions client path", () => {
  it("exposes OpenAI chat-completions capability metadata", () => {
    const model = new OpenAIChatCompletionModel({} as never, "custom-chat-model");

    expect(model.provider).toBe("openai-chat");
    expect(model.defaultModel).toBe("custom-chat-model");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: false,
      outputSchema: true,
      reasoning: true,
    });
  });

  it("creates OpenAI chat-completions models", async () => {
    const calls: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            calls.push(params);
            return {
              choices: [{ message: { role: "assistant", content: "ok" } }],
              usage: {},
            };
          },
        },
      },
    };

    const openai = new OpenAIClient({
      client: client as never,
      completionApi: "chat",
    });
    const model = openai.completionModel("custom-chat-model");

    expect(model).toBeInstanceOf(OpenAIChatCompletionModel);
    await model.completion({
      chatHistory: [Message.user("hello", { metadata: { composer: { entities: [] } } })],
      documents: [],
      tools: [],
    });
    expect(calls).toEqual([
      {
        model: "custom-chat-model",
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
  });

  it("uses chat completions by default for custom base URLs", () => {
    const openai = new OpenAIClient({
      apiKey: "test",
      baseUrl: "https://provider.example.com/v1",
    });

    expect(openai.completionModel("custom-chat-model")).toBeInstanceOf(OpenAIChatCompletionModel);
  });

  it("preserves assistant reasoning and provider tool call ids across tool turns", () => {
    const params = toOpenAIChatCompletionParams("kimi-k2.6", {
      chatHistory: [
        Message.assistant([
          AssistantContent.reasoning("provider reasoning text"),
          AssistantContent.toolCall("tool_0", "create_task", { title: "A" }, "call_abc"),
        ]),
        Message.tool(ToolContent.toolResult("tool_0", '{"id":"task_1"}', "call_abc")),
        Message.user("continue"),
      ],
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([
      {
        role: "assistant",
        reasoning_content: "provider reasoning text",
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "create_task", arguments: '{"title":"A"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_abc", content: '{"id":"task_1"}' },
      { role: "user", content: "continue" },
    ]);
  });

  it("serializes valid scalar tool arguments in assistant history as JSON", () => {
    const params = toOpenAIChatCompletionParams("custom-chat-model", {
      chatHistory: [Message.assistant([AssistantContent.toolCall("tool_0", "Echo", "hello")])],
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "tool_0",
            type: "function",
            function: { name: "Echo", arguments: '"hello"' },
          },
        ],
      },
    ]);
  });

  it("adds compatible content to reasoning-only assistant history", () => {
    const chatHistory = [
      Message.user("First question"),
      Message.assistant([AssistantContent.reasoning("internal reasoning only")]),
      Message.user("Continue"),
    ];
    const originalChatHistory = structuredClone(chatHistory);

    const params = toOpenAIChatCompletionParams("deepseek-v4-flash", {
      chatHistory,
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([
      { role: "user", content: "First question" },
      {
        role: "assistant",
        content: " ",
        reasoning_content: "internal reasoning only",
      },
      { role: "user", content: "Continue" },
    ]);
    expect(chatHistory).toEqual(originalChatHistory);
  });

  it("preserves ordinary assistant text history", () => {
    const params = toOpenAIChatCompletionParams("deepseek-v4-flash", {
      chatHistory: [Message.assistant("visible response")],
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([{ role: "assistant", content: "visible response" }]);
  });

  it("adds compatible content to empty assistant history", () => {
    const params = toOpenAIChatCompletionParams("deepseek-v4-flash", {
      chatHistory: [Message.assistant([])],
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([{ role: "assistant", content: " " }]);
  });

  it("summarizes provider request metadata for traces", () => {
    const model = new OpenAIChatCompletionModel({} as never, "chat-test");
    const request: CompletionRequest = {
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [{ name: "add", description: "Add numbers", parameters: { type: "object" } }],
      maxTokens: 64,
      toolChoice: { type: "function", name: "add" },
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "openai-chat",
      api: "chat.completions",
      stream: true,
      model: "chat-test",
      messageCount: 1,
      toolCount: 1,
      toolNames: ["add"],
      parameterKeys: expect.arrayContaining(["messages", "model", "stream", "stream_options"]),
    });
  });

  it("maps non-streaming reasoning_content responses to assistant reasoning", () => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: "created",
            reasoning_content: "provider reasoning text",
          },
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      AssistantContent.reasoning("provider reasoning text"),
      AssistantContent.text("created"),
    ]);
  });

  it("uses one stable reasoning id for interleaved Chat Completions chunks", async () => {
    const model = openAIChatModelWithStreams([reasoningInterleaveStream()]);

    const events = await collectStreamEvents(model);
    const reasoningEvents = streamedReasoningEvents(events);

    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents[0]?.id).toEqual(expect.any(String));
    expect(reasoningEvents[0]?.id).not.toBe("");
    expect(reasoningEvents[1]?.id).toBe(reasoningEvents[0]?.id);
  });

  it("uses a different reasoning id for each streamCompletion invocation", async () => {
    const model = openAIChatModelWithStreams([
      reasoningInterleaveStream(),
      reasoningInterleaveStream(),
    ]);

    const firstId = streamedReasoningEvents(await collectStreamEvents(model))[0]?.id;
    const secondId = streamedReasoningEvents(await collectStreamEvents(model))[0]?.id;

    expect(firstId).toEqual(expect.any(String));
    expect(secondId).toEqual(expect.any(String));
    expect(secondId).not.toBe(firstId);
  });

  it("assembles interleaved reasoning and text into one ordered Agent response", async () => {
    const model = openAIChatModelWithStreams([reasoningInterleaveStream()]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(agent.prompt("introduce yourself").stream());
    const turnEnd = events.find((event) => event.type === "turn_end");

    expect(turnEnd?.type).toBe("turn_end");
    if (turnEnd?.type !== "turn_end") {
      throw new Error("Expected AgentBuilder to emit a turn_end event");
    }
    expect(turnEnd.response.choice).toEqual([
      {
        type: "reasoning",
        id: expect.any(String),
        text: "Let me provide a straightforward introduction.",
      },
      AssistantContent.text("Hello, Indra Zulfi! I'm DeepSeek V4 Pro"),
    ]);
  });

  it("maps reasoning before visible text within the same chunk", () => {
    expect(
      fromOpenAIChatCompletionStreamChunk({
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: {
              content: "answer",
              reasoning_content: "think",
            },
          },
        ],
      }),
    ).toEqual([
      { type: "reasoning_delta", delta: "think" },
      { type: "text_delta", delta: "answer" },
    ]);
  });

  it("emits text-only Chat Completions deltas incrementally and unchanged", async () => {
    const model = openAIChatModelWithStreams([
      [
        {
          choices: [{ index: 0, finish_reason: null, delta: { content: "hello" } }],
        },
        {
          choices: [{ index: 0, finish_reason: "stop", delta: { content: " world" } }],
        },
      ],
    ]);
    const iterator = model
      .streamCompletion({
        chatHistory: [Message.user("say hello")],
        documents: [],
        tools: [],
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "text_delta", delta: "hello" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "text_delta", delta: " world" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("rejects malformed non-streaming tool arguments", () => {
    expect(() =>
      fromOpenAIChatCompletionResponse({
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "tool_0",
                  type: "function",
                  function: { name: "ExecCommand", arguments: '{"command":"pwd"' },
                },
              ],
            },
          },
        ],
        usage: {},
      }),
    ).toThrow(
      'Completion returned tool call "tool_0" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
    );
  });

  it.each([
    ["scalar", '"hello"', "hello"],
    ["empty", "", {}],
    ["whitespace-only", " \n\t", {}],
  ])("maps %s non-streaming tool arguments", (_label, argumentsText, expectedArguments) => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "tool_0",
                type: "function",
                function: { name: "Echo", arguments: argumentsText },
              },
            ],
          },
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("tool_0", "Echo", expectedArguments),
    ]);
  });

  it("maps Chat Completions refusals to visible assistant text", () => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            refusal: "I can't help with that.",
          },
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([AssistantContent.text("I can't help with that.")]);

    expect(
      fromOpenAIChatCompletionStreamChunk({
        id: "cmpl_1",
        choices: [
          {
            delta: {
              refusal: "I can't help with that.",
            },
          },
        ],
      }),
    ).toEqual([
      { type: "text_delta", delta: "I can't help with that." },
      { type: "message_id", id: "cmpl_1" },
    ]);
  });

  it("does not fabricate usage before a Chat Completions usage chunk", () => {
    const events = fromOpenAIChatCompletionStreamChunk({
      id: "cmpl_without_usage",
      choices: [{ index: 0, finish_reason: "stop", delta: { content: "done" } }],
    });

    expect(events).toEqual([
      { type: "text_delta", delta: "done" },
      { type: "message_id", id: "cmpl_without_usage" },
    ]);
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it("assembles Devscale-style streamed tool fragments into one valid call", async () => {
    const calls: unknown[] = [];
    const model = openAIChatModelWithStreams([
      [
        chatChunk([chatChoice([toolCallDelta(0, "call_exec", "ExecCommand")])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", "{")])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", '"command": ')])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", '"pwd"')])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", "}")])]),
        chatChunk([chatChoice([], 0, "tool_calls")]),
      ],
      finalTextStream(),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(recordingTool("ExecCommand", calls))
      .build();

    const events = await collect(agent.prompt("run pwd").stream());

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }, "call_exec"),
    });
    expect(calls).toEqual([{ command: "pwd" }]);
  });

  it("keeps interleaved streamed tool calls separate and ordered", async () => {
    const execCalls: unknown[] = [];
    const readCalls: unknown[] = [];
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice([
            toolCallDelta(0, "call_exec", "ExecCommand"),
            toolCallDelta(1, "call_read", "ReadFile"),
          ]),
        ]),
        chatChunk([chatChoice([toolCallDelta(1, "", "", "{")])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", "{")])]),
        chatChunk([chatChoice([toolCallDelta(1, "", "", '"file_path":"README.md"')])]),
        chatChunk([chatChoice([toolCallDelta(0, "", "", '"command":"pwd"')])]),
        chatChunk([chatChoice([toolCallDelta(1, "", "", "}"), toolCallDelta(0, "", "", "}")])]),
        chatChunk([chatChoice([], 0, "tool_calls")]),
      ],
      finalTextStream(),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(recordingTool("ExecCommand", execCalls))
      .tool(recordingTool("ReadFile", readCalls))
      .build();

    const events = await collect(agent.prompt("run tools").stream());

    expect(events.flatMap((event) => (event.type === "tool_call" ? [event.toolCall] : []))).toEqual(
      [
        AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }, "call_exec"),
        AssistantContent.toolCall("tool_1", "ReadFile", { file_path: "README.md" }, "call_read"),
      ],
    );
    expect(execCalls).toEqual([{ command: "pwd" }]);
    expect(readCalls).toEqual([{ file_path: "README.md" }]);
  });

  it("rejects two streamed tool calls with missing indices instead of merging them", async () => {
    const calls: unknown[] = [];
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice([
            toolCallDelta(undefined, "call_exec", "ExecCommand", '{"command":"pwd"}'),
            toolCallDelta(undefined, "call_read", "ReadFile", '{"file_path":"README.md"}'),
          ]),
        ]),
        chatChunk([chatChoice([], 0, "tool_calls")]),
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(recordingTool("ExecCommand", calls))
      .tool(recordingTool("ReadFile", calls))
      .build();

    await expect(collect(agent.prompt("run tools").stream())).rejects.toThrow(
      INVALID_TOOL_INDEX_ERROR,
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["string", "0"],
    ["nonnumeric", "not-a-number"],
    ["NaN", Number.NaN],
    ["negative", -1],
    ["fractional", 0.5],
    ["missing", undefined],
  ])("rejects a %s streamed tool-call index", (_label, index) => {
    expect(() =>
      fromOpenAIChatCompletionStreamChunk(
        chatChunk([chatChoice([toolCallDelta(index, "call_echo", "Echo", "{}")])]),
      ),
    ).toThrow(INVALID_TOOL_INDEX_ERROR);
  });

  it("selects completion choice zero without merging alternatives", () => {
    const events = fromOpenAIChatCompletionStreamChunk(
      chatChunk([
        chatChoice([toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')], 0),
        chatChoice([toolCallDelta(0, "call_read", "ReadFile", '{"file_path":"README.md"}')], 1),
      ]),
    );

    expect(events.filter((event) => event.type === "tool_call_delta")).toEqual([
      {
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_exec",
        name: "ExecCommand",
        argumentsDelta: '{"command":"pwd"}',
      },
    ]);
    expect(
      fromOpenAIChatCompletionResponse({
        choices: [
          { index: 1, message: { content: "second" } },
          { index: 0, message: { content: "first" } },
        ],
        usage: {},
      }).choice,
    ).toEqual([AssistantContent.text("first")]);
  });

  it("rejects ambiguous unindexed completion choices", () => {
    expect(() =>
      fromOpenAIChatCompletionStreamChunk({
        choices: [{ delta: { content: "first" } }, { delta: { content: "second" } }],
      }),
    ).toThrow(AMBIGUOUS_CHOICE_ERROR);
  });

  it("rejects a tool-call stream that ends without a terminal finish reason", async () => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice([toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')]),
        ]),
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toThrow(MISSING_TOOL_FINISH_ERROR);
    await expect(
      collectStreamEvents(
        openAIChatModelWithStreams([
          [
            {
              choices: [{ index: 0, finish_reason: null, delta: { content: "partial" } }],
            },
          ],
        ]),
      ),
    ).resolves.toEqual([{ type: "text_delta", delta: "partial" }]);
    expect(MISSING_TOOL_FINISH_ERROR).not.toContain("pwd");
  });

  it.each([
    "tool_calls",
    "stop",
    "function_call",
  ])("accepts a completed tool-call stream ending with %s", async (finishReason) => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice(
            [toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')],
            0,
            finishReason,
          ),
        ]),
      ],
    ]);

    await expect(collectStreamEvents(model)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_call_delta", id: "tool_0" })]),
    );
  });

  it.each([
    ["length", LENGTH_TOOL_FINISH_ERROR],
    ["content_filter", CONTENT_FILTER_TOOL_FINISH_ERROR],
    ["abort", UNSUPPORTED_TOOL_FINISH_ERROR],
  ])("rejects a tool-call stream ending with %s", async (finishReason, expectedError) => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice(
            [toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"')],
            0,
            finishReason,
          ),
        ]),
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toThrow(expectedError);
    expect(expectedError).not.toContain("pwd");
  });

  it("rejects conflicting terminal finish reasons", async () => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice(
            [toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')],
            0,
            "tool_calls",
          ),
        ]),
        chatChunk([chatChoice([], 0, "stop")]),
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toThrow(CONFLICTING_TOOL_FINISH_ERROR);
  });

  it("attributes malformed arguments after a terminal tool finish to provider output", async () => {
    const calls: unknown[] = [];
    const model = openAIChatModelWithStreams([
      [
        chatChunk([chatChoice([toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"')])]),
        chatChunk([chatChoice([], 0, "tool_calls")]),
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(recordingTool("ExecCommand", calls))
      .build();

    await expect(collect(agent.prompt("run pwd").stream())).rejects.toThrow(
      'Completion returned tool call "tool_0" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
    );
    expect(calls).toHaveLength(0);
  });

  it("omits empty streamed tool metadata while preserving argument fragments", () => {
    expect(
      fromOpenAIChatCompletionStreamChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "",
                  function: {
                    name: "",
                    arguments: '{"command":"pwd"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        type: "tool_call_delta",
        id: "tool_0",
        argumentsDelta: '{"command":"pwd"}',
      },
    ]);
  });

  it("preserves empty streamed tool argument fragments", () => {
    expect(
      fromOpenAIChatCompletionStreamChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "",
                  function: { name: "", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([{ type: "tool_call_delta", id: "tool_0", argumentsDelta: "" }]);
  });

  it("rejects unsupported document file input before provider calls", async () => {
    const calls: unknown[] = [];
    const model = new OpenAIChatCompletionModel(
      {
        chat: {
          completions: {
            create: async (params: unknown) => {
              calls.push(params);
              return {};
            },
          },
        },
      } as never,
      "custom-chat-model",
    );

    await expect(
      model.completion({
        chatHistory: [
          Message.user([UserContent.documentUrl("https://example.com/a.pdf", "application/pdf")]),
        ],
        documents: [],
        tools: [],
      }),
    ).rejects.toThrow("openai-chat:custom-chat-model does not support document file input.");
    expect(calls).toHaveLength(0);
  });
});

function openAIChatModelWithStreams(streams: unknown[][]): OpenAIChatCompletionModel {
  return new OpenAIChatCompletionModel(
    {
      chat: {
        completions: {
          create: async () => streamFrom(streams.shift() ?? []),
        },
      },
    } as never,
    "chat-test",
  );
}

function chatChunk(choices: unknown[]): unknown {
  return { id: "chatcmpl_test", choices };
}

function chatChoice(toolCalls: unknown[], index = 0, finishReason: unknown = null): unknown {
  return {
    index,
    finish_reason: finishReason,
    delta: { tool_calls: toolCalls },
  };
}

function toolCallDelta(index: unknown, id: string, name: string, argumentsText?: string): unknown {
  const fn: Record<string, unknown> = { name };
  if (argumentsText !== undefined) {
    fn.arguments = argumentsText;
  }
  return { index, id, function: fn };
}

function recordingTool(name: string, calls: unknown[]): Tool {
  return {
    name,
    definition() {
      return { name, description: `Record ${name} calls`, parameters: { type: "object" } };
    },
    call(args) {
      calls.push(args);
      return "ok";
    },
  };
}

function finalTextStream(): unknown[] {
  return [
    {
      id: "chatcmpl_final",
      choices: [{ index: 0, finish_reason: null, delta: { content: "done" } }],
    },
    {
      id: "chatcmpl_final",
      choices: [{ index: 0, finish_reason: "stop", delta: {} }],
    },
  ];
}

function reasoningInterleaveStream(): unknown[] {
  return [
    {
      id: "chatcmpl-repro",
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: { reasoning_content: "Let me provide a straightfo" },
        },
      ],
    },
    {
      id: "chatcmpl-repro",
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: { content: "Hello, Indra Z" },
        },
      ],
    },
    {
      id: "chatcmpl-repro",
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: { reasoning_content: "rward introduction." },
        },
      ],
    },
    {
      id: "chatcmpl-repro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          delta: { content: "ulfi! I'm DeepSeek V4 Pro" },
        },
      ],
    },
  ];
}

async function collectStreamEvents(
  model: OpenAIChatCompletionModel,
): Promise<CompletionStreamEvent[]> {
  return collect(
    model.streamCompletion({
      chatHistory: [Message.user("run a tool")],
      documents: [],
      tools: [],
    }),
  );
}

async function* streamFrom(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) {
    yield event;
  }
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

function streamedReasoningEvents(
  events: CompletionStreamEvent[],
): Array<Extract<CompletionStreamEvent, { type: "reasoning_delta" }>> {
  return events.filter(
    (event): event is Extract<CompletionStreamEvent, { type: "reasoning_delta" }> =>
      event.type === "reasoning_delta",
  );
}
