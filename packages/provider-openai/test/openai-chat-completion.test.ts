import { Agent, type Tool } from "@anvia/core";
import {
  COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
  type CompletionModelStreamEvent,
  type CompletionRequest,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import { OpenAIClient } from "../src/index";
import {
  fromOpenAIChatCompletionResponse,
  fromOpenAIChatCompletionStreamChunk,
  OpenAIChatCompletionModel,
  toOpenAIChatCompletionParams,
} from "../src/openai/chat-completion";

describe("OpenAI chat-completions client path", () => {
  it("maps canonical reasoning effort after raw provider options", () => {
    expect(
      toOpenAIChatCompletionParams("gpt-5", {
        chatHistory: [Message.user("hello")],
        documents: [],
        tools: [],
        controls: { reasoningEffort: "high" },
        providerOptions: { reasoning_effort: "low" },
      }),
    ).toMatchObject({ reasoning_effort: "high" });
  });

  it("exposes OpenAI chat-completions capability metadata", () => {
    const model = new OpenAIChatCompletionModel({} as never, "custom-chat-model");

    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("custom-chat-model");
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

    const openai = new OpenAIClient({ client: client as never });
    const model = openai.completionModel({ modelId: "custom-chat-model", api: "chat" });

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

  it("preserves normalized and provider finish reasons for non-streaming responses", () => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: '{"answer":"partial' },
        },
      ],
      usage: {},
    });

    expect(response).toMatchObject({
      finishReason: "length",
      providerFinishReason: "length",
    });
  });

  it("keeps protocol selection explicit for custom base URLs", () => {
    const openai = new OpenAIClient({
      apiKey: "test",
      baseUrl: "https://provider.example.com/v1",
    });

    expect(openai.completionModel({ modelId: "custom-chat-model", api: "chat" })).toBeInstanceOf(
      OpenAIChatCompletionModel,
    );
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

  it("keeps strict json_schema response formatting for structured output", () => {
    const schema = {
      type: "object",
      properties: { phase: { type: "string" } },
      required: ["phase"],
      additionalProperties: false,
      title: "hypothesis_response",
    };

    const params = toOpenAIChatCompletionParams("custom-chat-model", {
      chatHistory: [Message.user("Create hypotheses")],
      documents: [],
      tools: [],
      outputSchema: schema,
    });

    expect(params.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "hypothesis_response",
        strict: true,
        schema,
      },
    });
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
      AssistantContent.reasoningFromContent([{ type: "text", text: "provider reasoning text" }]),
      AssistantContent.text("created"),
    ]);
  });

  it("normalizes cached and reasoning token usage into exclusive details", () => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [{ message: { role: "assistant", content: "done" } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    });

    expect(response.usage).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 0,
      details: {
        input: 7,
        input_cached_tokens: 3,
        output: 2,
        output_reasoning_tokens: 2,
        total: 14,
      },
    });
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
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "introduce yourself" }));
    const turnEnd = events.find((event) => event.type === "turn_end");

    expect(turnEnd?.type).toBe("turn_end");
    if (turnEnd?.type !== "turn_end") {
      throw new Error("Expected Agent to emit a turn_end event");
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
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "final",
        response: {
          finishReason: "stop",
          providerFinishReason: "stop",
        },
      },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("preserves a length finish reason for text-only streams", async () => {
    const model = openAIChatModelWithStreams([
      [
        {
          choices: [
            { index: 0, finish_reason: "length", delta: { content: '{"answer":"partial' } },
          ],
        },
        { choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
      ],
    ]);

    const events = await collectStreamEvents(model);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      response: {
        finishReason: "length",
        providerFinishReason: "length",
      },
    });
  });

  it("preserves a terminal finish reason when an OpenAI-compatible stream omits usage", async () => {
    const model = openAIChatModelWithStreams([
      [
        {
          id: "cmpl_without_usage",
          choices: [
            { index: 0, finish_reason: "length", delta: { content: '{"answer":"partial' } },
          ],
        },
      ],
    ]);

    const events = await collectStreamEvents(model);
    expect(events.at(-1)).toEqual({
      type: "final",
      response: {
        choice: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        finishReason: "length",
        providerFinishReason: "length",
        rawResponse: {
          id: "cmpl_without_usage",
          choices: [
            { index: 0, finish_reason: "length", delta: { content: '{"answer":"partial' } },
          ],
        },
        messageId: "cmpl_without_usage",
      },
    });
  });

  it("rejects malformed non-streaming tool arguments", () => {
    const error = thrownBy(() =>
      fromOpenAIChatCompletionResponse({
        choices: [
          {
            finish_reason: "tool_calls",
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
        usage: {
          prompt_tokens: 7,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      }),
    );

    expect(error).toMatchObject(
      providerOutputError("malformed-tool-arguments", {
        toolCallId: "tool_0",
        usage: {
          inputTokens: 7,
          outputTokens: 2,
          totalTokens: 9,
          cachedInputTokens: 3,
        },
      }),
    );
  });

  it("retries malformed provider tool-call arguments without executing the tool", async () => {
    const completionRequests: unknown[] = [];
    const toolExecutions: unknown[] = [];
    const client = new OpenAIClient({
      client: {
        chat: {
          completions: {
            create: async (request: unknown) => {
              completionRequests.push(request);
              return {
                id: "chatcmpl_malformed_tool",
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "tool_0",
                          type: "function",
                          function: { name: "test_tool", arguments: '{"query":' },
                        },
                      ],
                    },
                  },
                ],
                usage: {},
              };
            },
          },
        },
      } as never,
    });
    const agent = new Agent({
      id: "malformed-tool-retry",
      model: client.completionModel({ modelId: "chat-test", api: "chat" }),
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const error = await agent
      .generate({
        prompt: "Call test_tool.",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      })
      .catch((value: unknown) => value);

    expect(toolExecutions).toHaveLength(0);
    expect(error).toMatchObject(
      providerOutputError("malformed-tool-arguments", { toolCallId: "tool_0" }),
    );
    expect(completionRequests).toHaveLength(3);
  });

  it("rejects and retries a valid tool call that is missing its finish reason", async () => {
    const completionRequests: unknown[] = [];
    const toolExecutions: unknown[] = [];
    const client = new OpenAIClient({
      client: {
        chat: {
          completions: {
            create: async (request: unknown) => {
              completionRequests.push(request);
              return {
                id: "chatcmpl_missing_tool_finish",
                choices: [
                  {
                    index: 0,
                    finish_reason: null,
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "tool_0",
                          type: "function",
                          function: { name: "test_tool", arguments: '{"query":"safe"}' },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 2, completion_tokens: 1 },
              };
            },
          },
        },
      } as never,
    });
    const agent = new Agent({
      id: "missing-chat-tool-finish",
      model: client.completionModel({ modelId: "chat-test", api: "chat" }),
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const error = await agent
      .generate({
        prompt: "Call test_tool.",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject(
      providerOutputError("incomplete-tool-call", {
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      }),
    );
    expect(completionRequests).toHaveLength(3);
    expect(toolExecutions).toHaveLength(0);
  });

  it.each([
    ["missing", undefined, "incomplete-tool-call"],
    ["non-string", { query: "x" }, "invalid-tool-arguments"],
    ["non-finite", "1e400", "invalid-tool-arguments"],
  ])("rejects %s terminal tool arguments", (_label, argumentsValue, kind) => {
    const error = thrownBy(() =>
      fromOpenAIChatCompletionResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "tool_0",
                  type: "function",
                  function: { name: "Echo", arguments: argumentsValue },
                },
              ],
            },
          },
        ],
        usage: {},
      }),
    );

    expect(error).toMatchObject(providerOutputError(kind, { toolCallId: "tool_0" }));
  });

  it.each([
    ["length", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
  ])(
    "prioritizes an unsafe %s finish over malformed Chat tool arguments",
    (providerFinishReason, kind, finishReason) => {
      const error = thrownBy(() =>
        fromOpenAIChatCompletionResponse({
          choices: [
            {
              finish_reason: providerFinishReason,
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "tool_0",
                    type: "function",
                    function: { name: "Echo", arguments: '{"query":' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      );

      expect(error).toMatchObject(
        providerOutputError(kind, {
          finishReason,
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        }),
      );
    },
  );

  it.each([
    ["length", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
  ])(
    "prioritizes an unsafe streamed %s finish over malformed native tool fields",
    async (providerFinishReason, kind, finishReason) => {
      const model = openAIChatModelWithStreams([
        [
          {
            choices: [
              {
                index: 0,
                finish_reason: providerFinishReason,
                delta: {
                  tool_calls: [
                    {
                      index: "invalid",
                      id: "call_exec",
                      function: { name: 42, arguments: { command: "pwd" } },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          },
        ],
      ]);

      await expect(collectStreamEvents(model)).rejects.toMatchObject(
        providerOutputError(kind, {
          finishReason,
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        }),
      );
    },
  );

  it.each([
    ["length", "truncated-tool-call", 3],
    ["content_filter", "filtered-tool-call", 1],
  ])(
    "does not execute a valid tool call ending with %s",
    async (finishReason, kind, expectedRequests) => {
      const completionRequests: unknown[] = [];
      const toolExecutions: unknown[] = [];
      const client = new OpenAIClient({
        client: {
          chat: {
            completions: {
              create: async (request: unknown) => {
                completionRequests.push(request);
                return {
                  choices: [
                    {
                      index: 0,
                      finish_reason: finishReason,
                      message: {
                        role: "assistant",
                        tool_calls: [
                          {
                            id: "tool_0",
                            type: "function",
                            function: { name: "test_tool", arguments: '{"query":"safe"}' },
                          },
                        ],
                      },
                    },
                  ],
                  usage: { prompt_tokens: 2, completion_tokens: 1 },
                };
              },
            },
          },
        } as never,
      });
      const agent = new Agent({
        id: `unsafe-finish-${finishReason}`,
        model: client.completionModel({ modelId: "chat-test", api: "chat" }),
        tools: [recordingTool("test_tool", toolExecutions)],
      });

      const error = await agent
        .generate({
          prompt: "Call test_tool.",
          retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
        })
        .catch((value: unknown) => value);

      expect(error).toMatchObject(providerOutputError(kind));
      expect(completionRequests).toHaveLength(expectedRequests);
      expect(toolExecutions).toHaveLength(0);
    },
  );

  it("maps scalar non-streaming tool arguments", () => {
    const response = fromOpenAIChatCompletionResponse({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "tool_0",
                type: "function",
                function: { name: "Echo", arguments: '"hello"' },
              },
            ],
          },
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("tool_0", "Echo", "hello", "tool_0"),
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t"],
  ])("rejects %s non-streaming tool arguments", (_label, argumentsText) => {
    expect(() =>
      fromOpenAIChatCompletionResponse({
        choices: [
          {
            finish_reason: "tool_calls",
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
      }),
    ).toThrowError(expect.objectContaining({ kind: "malformed-tool-arguments" }));
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
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [recordingTool("ExecCommand", calls)],
    });

    const events = await collect(agent.stream({ prompt: "run pwd" }));

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
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [recordingTool("ExecCommand", execCalls), recordingTool("ReadFile", readCalls)],
    });

    const events = await collect(agent.stream({ prompt: "run tools" }));

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
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [recordingTool("ExecCommand", calls), recordingTool("ReadFile", calls)],
    });

    const events = await collect(agent.stream({ prompt: "run tools" }));
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: providerOutputError("invalid-tool-call"),
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed streamed tool-call containers and discriminants", () => {
    expect(
      thrownBy(() =>
        fromOpenAIChatCompletionStreamChunk({
          choices: [{ index: 0, delta: { tool_calls: { invalid: true } } }],
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call"));

    expect(
      thrownBy(() =>
        fromOpenAIChatCompletionStreamChunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_0",
                    type: "custom",
                    function: { name: "Echo", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call", { toolCallId: "call_0" }));
  });

  it("rejects non-function non-streaming tool-call discriminants", () => {
    expect(
      thrownBy(() =>
        fromOpenAIChatCompletionResponse({
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    id: "call_0",
                    type: "custom",
                    function: { name: "Echo", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: {},
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call", { toolCallId: "call_0" }));
  });

  it.each([
    ["length", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
  ] as const)(
    "gives %s precedence over a malformed non-streaming tool-call container",
    (providerFinishReason, kind, finishReason) => {
      expect(
        thrownBy(() =>
          fromOpenAIChatCompletionResponse({
            choices: [
              {
                index: 0,
                finish_reason: providerFinishReason,
                message: { tool_calls: { invalid: true } },
              },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          }),
        ),
      ).toMatchObject(
        providerOutputError(kind, {
          finishReason,
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        }),
      );
    },
  );

  it.each([
    ["string", "0"],
    ["nonnumeric", "not-a-number"],
    ["NaN", Number.NaN],
    ["negative", -1],
    ["fractional", 0.5],
    ["missing", undefined],
  ])("rejects a %s streamed tool-call index", (_label, index) => {
    expect(
      thrownBy(() =>
        fromOpenAIChatCompletionStreamChunk(
          chatChunk([chatChoice([toolCallDelta(index, "call_echo", "Echo", "{}")])]),
        ),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call"));
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
    expect(
      thrownBy(() =>
        fromOpenAIChatCompletionStreamChunk({
          choices: [{ delta: { content: "first" } }, { delta: { content: "second" } }],
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call"));
  });

  it("rejects a tool-call stream that ends without a terminal finish reason", async () => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice([toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')]),
        ]),
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toMatchObject(
      providerOutputError("incomplete-tool-call"),
    );
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
  });

  it.each(["tool_calls", "stop", "function_call"])(
    "accepts a completed tool-call stream ending with %s",
    async (finishReason) => {
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
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call_delta", id: "tool_0" }),
        ]),
      );
    },
  );

  it.each([
    ["length", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
    ["abort", "invalid-tool-call", undefined],
  ])("rejects a tool-call stream ending with %s", async (finishReason, kind, normalizedReason) => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice(
            [toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"')],
            0,
            finishReason,
          ),
        ]),
        {
          id: "chatcmpl_test",
          choices: [],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        },
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toMatchObject(
      providerOutputError(kind, {
        finishReason: normalizedReason,
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      }),
    );
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

    await expect(collectStreamEvents(model)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call"),
    );
  });

  it("rejects streams that contain choices but never a primary choice", async () => {
    const model = openAIChatModelWithStreams([
      [
        {
          choices: [{ index: 1, finish_reason: "stop", delta: { content: "alternate" } }],
        },
        { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call"),
    );
  });

  it("rejects malformed choice entries instead of silently dropping them", () => {
    expect(() =>
      fromOpenAIChatCompletionStreamChunk({ choices: [null, { index: 0, delta: {} }] }),
    ).toThrowError(expect.objectContaining(providerOutputError("invalid-tool-call")));
  });

  it("rejects semantic progress after a terminal finish reason", async () => {
    const model = openAIChatModelWithStreams([
      [
        chatChunk([
          chatChoice(
            [toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"}')],
            0,
            "tool_calls",
          ),
        ]),
        chatChunk([{ index: 0, finish_reason: null, delta: { content: "late" } }]),
      ],
    ]);

    await expect(collectStreamEvents(model)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call"),
    );
  });

  it("attributes malformed arguments after a terminal tool finish to provider output", async () => {
    const calls: unknown[] = [];
    const remainingStreams = [
      [
        chatChunk([chatChoice([toolCallDelta(0, "call_exec", "ExecCommand", '{"command":"pwd"')])]),
        chatChunk([chatChoice([], 0, "tool_calls")]),
      ],
      finalTextStream(),
      finalTextStream(),
    ];
    const model = openAIChatModelWithStreams(remainingStreams);
    const agent = new Agent({
      id: "test-agent",
      model,
      tools: [recordingTool("ExecCommand", calls)],
    });

    const events = await collect(
      agent.stream({
        prompt: "run pwd",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: providerOutputError("malformed-tool-arguments", { toolCallId: "tool_0" }),
    });
    expect(calls).toHaveLength(0);
    expect(remainingStreams).toHaveLength(2);
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
    ).rejects.toThrow("openai:custom-chat-model does not support document file input.");
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
  return { index, id, type: "function", function: fn };
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
): Promise<CompletionModelStreamEvent[]> {
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

function thrownBy(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("Expected callback to throw.");
}

function providerOutputError(
  kind: string,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "CompletionProviderOutputError",
    code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
    kind,
    ...values,
  };
}

function streamedReasoningEvents(
  events: CompletionModelStreamEvent[],
): Array<Extract<CompletionModelStreamEvent, { type: "reasoning_delta" }>> {
  return events.filter(
    (event): event is Extract<CompletionModelStreamEvent, { type: "reasoning_delta" }> =>
      event.type === "reasoning_delta",
  );
}
