import {
  type CompletionModelStreamEvent,
  type CompletionRequest,
  streamCompletion,
  Usage,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import {
  fromMistralChatResponse,
  fromMistralChatStreamChunk,
  MistralClient,
  mistralMessageHelpers,
  toMistralChatParams,
} from "../src/index";
import { MistralCompletionModel } from "../src/mistral/completion";

describe("Mistral completion mapping", () => {
  it("exposes Mistral capability metadata", () => {
    const model = new MistralCompletionModel({} as never, "mistral-test");

    expect(model.provider).toBe("mistral");
    expect(model.modelId).toBe("mistral-test");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: true,
      reasoning: false,
    });
  });

  it("exposes model-specific context limits", () => {
    const model = new MistralClient({ client: {} as never }).completionModel({
      modelId: "mistral-medium-3-5",
    });

    expect(model.modelId).toBe("mistral-medium-3-5");
    expect(model.contextLimits).toEqual({
      contextWindow: 256_000,
    });
  });

  it("rejects unsupported image input before provider calls", async () => {
    const calls: unknown[] = [];
    const model = new MistralCompletionModel(
      {
        chat: {
          complete: async (params: unknown) => {
            calls.push(params);
            return {};
          },
        },
      } as never,
      "mistral-test",
    );

    await expect(
      model.completion({
        chatHistory: [Message.user([UserContent.imageUrl("https://example.com/a.png")])],
        documents: [],
        tools: [],
      }),
    ).rejects.toThrow("mistral:mistral-test does not support image input.");
    expect(calls).toHaveLength(0);
  });

  it("rejects unsupported document file input before provider calls", async () => {
    const calls: unknown[] = [];
    const model = new MistralCompletionModel(
      {
        chat: {
          complete: async (params: unknown) => {
            calls.push(params);
            return {};
          },
        },
      } as never,
      "mistral-test",
    );

    await expect(
      model.completion({
        chatHistory: [
          Message.user([UserContent.documentUrl("https://example.com/a.pdf", "application/pdf")]),
        ],
        documents: [],
        tools: [],
      }),
    ).rejects.toThrow("mistral:mistral-test does not support document file input.");
    expect(calls).toHaveLength(0);
  });

  it("summarizes provider request metadata for traces", () => {
    const model = new MistralCompletionModel({} as never, "mistral-test");
    const request: CompletionRequest = {
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [{ name: "add", description: "Add numbers", parameters: { type: "object" } }],
      maxTokens: 128,
      toolChoice: "auto",
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "mistral",
      api: "chat.stream",
      stream: true,
      model: "mistral-test",
      messageCount: 1,
      toolCount: 1,
      toolNames: ["add"],
      parameterKeys: expect.arrayContaining(["messages", "model", "tools"]),
    });
  });

  it("maps normalized requests to Mistral chat params", () => {
    const request: CompletionRequest = {
      instructions: "Use the support policy.",
      chatHistory: [
        Message.system("System context."),
        Message.user("What is the order status?", {
          metadata: { composer: { entities: [] } },
        }),
        Message.assistant([AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" })]),
        Message.tool(ToolContent.toolResult("call_1", "shipped", { toolName: "lookup_order" })),
      ],
      documents: [{ id: "policy", text: "Refunds take 5 days." }],
      tools: [
        { name: "lookup_order", description: "Look up an order.", parameters: { type: "object" } },
      ],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "required",
      outputSchema: { type: "object", title: "OrderAnswer" },
      providerOptions: {
        topP: 0.9,
        temperature: 0.4,
      },
    };

    expect(toMistralChatParams("mistral-large-latest", request)).toEqual({
      model: "mistral-large-latest",
      messages: [
        { role: "system", content: "Use the support policy." },
        { role: "system", content: "System context." },
        { role: "user", content: "<file id: policy>\nRefunds take 5 days.\n</file>\n" },
        { role: "user", content: "What is the order status?" },
        {
          role: "assistant",
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "lookup_order",
                arguments: '{"id":"A1"}',
              },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          name: "lookup_order",
          content: "shipped",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_order",
            description: "Look up an order.",
            parameters: { type: "object" },
          },
        },
      ],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "any",
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "OrderAnswer",
          strict: true,
          schema: { type: "object", title: "OrderAnswer" },
        },
      },
      topP: 0.9,
    });
  });

  it("maps specific tool choice to a function tool choice", () => {
    expect(
      toMistralChatParams("mistral-large-latest", {
        chatHistory: [Message.user("hi")],
        documents: [],
        tools: [],
        toolChoice: { type: "function", name: "lookup" },
      }).toolChoice,
    ).toEqual({
      type: "function",
      function: { name: "lookup" },
    });
  });

  it("does not allow additional params to override model or messages", () => {
    const params = toMistralChatParams("mistral-large-latest", {
      chatHistory: [Message.user("hi")],
      documents: [],
      tools: [],
      providerOptions: {
        model: "unsafe-model",
        messages: [{ role: "user", content: "injected" }],
        topP: 0.9,
      },
    });

    expect(params).toEqual({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "hi" }],
      topP: 0.9,
    });
  });

  it("uses the explicit tool result name", () => {
    expect(
      mistralMessageHelpers.messageToMistralMessages(
        Message.tool(ToolContent.toolResult("call_1", "shipped", { toolName: "lookup_order" })),
      ),
    ).toEqual([
      {
        role: "tool",
        toolCallId: "call_1",
        name: "lookup_order",
        content: "shipped",
      },
    ]);
  });

  it("throws on malformed tool call arguments instead of coercing them", () => {
    expect(() =>
      fromMistralChatResponse({
        choices: [
          {
            finishReason: "tool_calls",
            message: {
              toolCalls: [
                {
                  id: "call_1",
                  function: { name: "lookup_order", arguments: '{"id":' },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow('Completion provider returned tool call "call_1" with malformed JSON arguments.');
  });

  it.each(["", "   ", "\n\t"])("rejects blank tool arguments (%j)", (argumentsValue) => {
    expect(() =>
      fromMistralChatResponse({
        choices: [
          {
            finishReason: "tool_calls",
            message: {
              toolCalls: [
                {
                  id: "call_1",
                  function: { name: "lookup", arguments: argumentsValue },
                },
              ],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CompletionProviderOutputError",
        kind: "malformed-tool-arguments",
        toolCallId: "call_1",
      }),
    );
  });

  it("accepts strict native object tool arguments", () => {
    const response = fromMistralChatResponse({
      id: "cmpl_1",
      choices: [
        {
          finishReason: "tool_calls",
          message: {
            toolCalls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: { query: "anvia" } },
              },
            ],
          },
        },
      ],
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("call_1", "lookup", { query: "anvia" }, "call_1"),
    ]);
  });

  it("rejects parsed and native arguments outside the JSON object contract", () => {
    for (const argumentsValue of [
      '{"value":1e400}',
      { value: Number.NaN },
      { value: undefined },
      [],
      null,
      1,
      undefined,
    ]) {
      expect(() =>
        fromMistralChatResponse({
          choices: [
            {
              finishReason: "tool_calls",
              message: {
                toolCalls: [
                  {
                    id: "call_1",
                    function: { name: "lookup", arguments: argumentsValue },
                  },
                ],
              },
            },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "CompletionProviderOutputError",
          kind: "invalid-tool-arguments",
          toolCallId: "call_1",
        }),
      );
    }
  });

  it("selects only the primary non-streaming choice", () => {
    const response = fromMistralChatResponse({
      choices: [
        {
          index: 1,
          finishReason: "tool_calls",
          message: {
            toolCalls: [
              {
                id: "call_delete",
                function: { name: "delete_all", arguments: "{}" },
              },
            ],
          },
        },
        {
          index: 0,
          finishReason: "tool_calls",
          message: {
            toolCalls: [
              {
                id: "call_lookup",
                function: { name: "lookup", arguments: '{"query":"anvia"}' },
              },
            ],
          },
        },
      ],
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("call_lookup", "lookup", { query: "anvia" }, "call_lookup"),
    ]);
  });

  it("selects only the primary streaming choice", () => {
    expect(
      fromMistralChatStreamChunk({
        choices: [
          {
            index: 1,
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_delete",
                  function: { name: "delete_all", arguments: "{}" },
                },
              ],
            },
          },
          {
            index: 0,
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_lookup",
                  function: { name: "lookup", arguments: '{"query":"anvia"}' },
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
        callId: "call_lookup",
        name: "lookup",
        argumentsDelta: '{"query":"anvia"}',
      },
    ]);
  });

  it("rejects an alternate-only stream instead of treating it as an empty response", async () => {
    const model = mistralModelWithChunks([
      {
        choices: [
          {
            index: 1,
            finishReason: "tool_calls",
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_delete",
                  function: { name: "delete_all", arguments: "{}" },
                },
              ],
            },
          },
        ],
        usage: { promptTokens: 3, completionTokens: 5 },
      },
    ]);

    const { error, events } = await collectMistralStreamError(model);
    expect(events.some((event) => event.type === "tool_call_delta")).toBe(false);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      usage: expect.objectContaining({ inputTokens: 3, outputTokens: 5 }),
    });
  });

  it("rejects invalid streamed choices with usage from the same chunk", async () => {
    const model = mistralModelWithChunks([
      {
        choices: [null],
        usage: { promptTokens: 7, completionTokens: 11 },
      },
    ]);

    const { error, events } = await collectMistralStreamError(model);
    expect(events).toEqual([]);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      usage: expect.objectContaining({ inputTokens: 7, outputTokens: 11 }),
    });
  });

  it("rejects a stream that never produces a primary choice", async () => {
    const model = mistralModelWithChunks([
      {
        choices: [],
        usage: { promptTokens: 19, completionTokens: 23 },
      },
    ]);

    const { error, events } = await collectMistralStreamError(model);
    expect(events).toEqual([]);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "incomplete-stream",
      usage: expect.objectContaining({ inputTokens: 19, outputTokens: 23 }),
    });
  });

  it("rejects an empty provider stream", async () => {
    const { error, events } = await collectMistralStreamError(mistralModelWithChunks([]));
    expect(events).toEqual([]);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "incomplete-stream",
    });
  });

  it("rejects unsafe terminal reasons before consuming tool arguments", () => {
    for (const [providerFinishReason, kind] of [
      ["length", "truncated-tool-call"],
      ["content_filter", "filtered-tool-call"],
    ] as const) {
      expect(() =>
        fromMistralChatResponse({
          choices: [
            {
              index: 0,
              finishReason: providerFinishReason,
              message: {
                toolCalls: [
                  {
                    id: "call_1",
                    function: { name: "lookup", arguments: '{"query":' },
                  },
                ],
              },
            },
          ],
          usage: { promptTokens: 2, completionTokens: 3 },
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "CompletionProviderOutputError",
          kind,
          usage: expect.objectContaining({ totalTokens: 5 }),
        }),
      );
    }
  });

  it("does not treat an empty non-streaming tool-call array as tool progress", () => {
    expect(
      fromMistralChatResponse({
        choices: [{ index: 0, finishReason: "stop", message: { toolCalls: [] } }],
        usage: {},
      }),
    ).toMatchObject({ choice: [], finishReason: "stop" });
  });

  it("rejects invalid streamed tool indexes and argument fragments", () => {
    for (const toolCall of [{ index: -1, function: { name: "lookup", arguments: "{}" } }]) {
      expect(() =>
        fromMistralChatStreamChunk({
          choices: [{ index: 0, delta: { toolCalls: [toolCall] } }],
        }),
      ).toThrowError(expect.objectContaining({ name: "CompletionProviderOutputError" }));
    }
  });

  it("maps strict native streamed arguments as a replace snapshot", () => {
    expect(
      fromMistralChatStreamChunk({
        choices: [
          {
            index: 0,
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "lookup", arguments: { query: "anvia" } },
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
        callId: "call_1",
        name: "lookup",
        argumentsDelta: '{"query":"anvia"}',
        argumentsMode: "replace",
      },
    ]);
  });

  it("rejects invalid native streamed argument objects", () => {
    for (const argumentsValue of [{ query: Number.NaN }, { query: undefined }, [], null, 1]) {
      expect(() =>
        fromMistralChatStreamChunk({
          choices: [
            {
              index: 0,
              delta: {
                toolCalls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "lookup", arguments: argumentsValue },
                  },
                ],
              },
            },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "CompletionProviderOutputError",
          kind: "invalid-tool-arguments",
          toolCallId: "call_1",
        }),
      );
    }
  });

  it("rejects non-function tool-call discriminants", () => {
    expect(() =>
      fromMistralChatResponse({
        choices: [
          {
            finishReason: "tool_calls",
            message: {
              toolCalls: [
                {
                  id: "call_1",
                  type: "builtin",
                  function: { name: "lookup", arguments: {} },
                },
              ],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CompletionProviderOutputError",
        kind: "invalid-tool-call",
        toolCallId: "call_1",
      }),
    );

    expect(() =>
      fromMistralChatStreamChunk({
        choices: [
          {
            index: 0,
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "builtin",
                  function: { name: "lookup", arguments: {} },
                },
              ],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CompletionProviderOutputError",
        kind: "invalid-tool-call",
        toolCallId: "call_1",
      }),
    );
  });

  it("requires a native terminal marker after streamed tool progress", async () => {
    const model = new MistralCompletionModel(
      {
        chat: {
          stream: async () =>
            (async function* () {
              yield {
                data: {
                  choices: [
                    {
                      index: 0,
                      delta: {
                        toolCalls: [
                          {
                            index: 0,
                            id: "call_1",
                            function: { name: "lookup", arguments: "{}" },
                          },
                        ],
                      },
                    },
                  ],
                },
              };
            })(),
        },
      } as never,
      "mistral-test",
    );

    const consume = async () => {
      for await (const _event of model.streamCompletion({
        chatHistory: [Message.user("lookup")],
        documents: [],
        tools: [],
      })) {
        // Exhaust the provider stream.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "incomplete-tool-call",
    });
  });

  it("rejects a non-streaming tool call without a finish reason", () => {
    expect(() =>
      fromMistralChatResponse({
        choices: [
          {
            message: {
              toolCalls: [{ id: "call_1", function: { name: "lookup", arguments: "{}" } }],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CompletionProviderOutputError",
        kind: "incomplete-tool-call",
      }),
    );
  });

  it("rejects conflicting streamed finish reasons", async () => {
    const model = mistralModelWithChunks([
      {
        choices: [
          {
            index: 0,
            finishReason: "tool_calls",
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "lookup", arguments: "{}" },
                },
              ],
            },
          },
        ],
        usage: {},
      },
      {
        choices: [{ index: 0, finishReason: "length", delta: {} }],
        usage: { promptTokens: 7, completionTokens: 11 },
      },
    ]);

    const { error } = await collectMistralStreamError(model);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      usage: expect.objectContaining({ inputTokens: 7, outputTokens: 11 }),
    });
  });

  it("rejects semantic progress after a streamed finish reason", async () => {
    const model = mistralModelWithChunks([
      { choices: [{ index: 0, finishReason: "stop", delta: { content: "done" } }] },
      {
        choices: [{ index: 0, delta: { content: "late" } }],
        usage: { promptTokens: 13, completionTokens: 17 },
      },
    ]);

    const { error, events } = await collectMistralStreamError(model);
    expect(events).toContainEqual({ type: "text_delta", delta: "done" });
    expect(events).not.toContainEqual({ type: "text_delta", delta: "late" });
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      usage: expect.objectContaining({ inputTokens: 13, outputTokens: 17 }),
    });
  });

  it.each([
    ["length", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
    ["unexpected_reason", "invalid-tool-call", "other"],
  ] as const)("gives %s precedence over invalid native streamed tool fields", async (providerFinishReason, kind, finishReason) => {
    const model = mistralModelWithChunks([
      {
        choices: [
          {
            index: 0,
            finishReason: providerFinishReason,
            delta: {
              toolCalls: [
                {
                  index: -1,
                  id: "call_1",
                  function: { name: "lookup", arguments: { query: "anvia" } },
                },
              ],
            },
          },
        ],
        usage: { promptTokens: 2, completionTokens: 3 },
      },
    ]);

    const { error, events } = await collectMistralStreamError(model);
    expect(events).toEqual([]);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind,
      finishReason,
      usage: expect.objectContaining({ inputTokens: 2, outputTokens: 3 }),
    });
  });

  it("derives deterministic ids for absent and SDK-placeholder tool-call ids", () => {
    const response = fromMistralChatResponse({
      id: "cmpl_9",
      choices: [
        {
          finishReason: "tool_calls",
          message: {
            toolCalls: [
              { function: { name: "first", arguments: "{}" } },
              { id: null, function: { name: "second", arguments: "{}" } },
              { id: "null", function: { name: "third", arguments: "{}" } },
            ],
          },
        },
      ],
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("cmpl_9-tool-0", "first", {}, "cmpl_9-tool-0"),
      AssistantContent.toolCall("cmpl_9-tool-1", "second", {}, "cmpl_9-tool-1"),
      AssistantContent.toolCall("cmpl_9-tool-2", "third", {}, "cmpl_9-tool-2"),
    ]);
  });

  it("exposes helper conversion for assistant tool-use history", () => {
    expect(
      mistralMessageHelpers.messageToMistralMessages(
        Message.assistant([AssistantContent.toolCall("call_1", "lookup", { query: "x" })]),
      ),
    ).toEqual([
      {
        role: "assistant",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "lookup",
              arguments: '{"query":"x"}',
            },
          },
        ],
      },
    ]);
  });

  it("maps Mistral responses to normalized completion responses", () => {
    const response = fromMistralChatResponse({
      id: "cmpl_1",
      choices: [
        {
          finishReason: "tool_calls",
          message: {
            content: "Use a reset link.",
            toolCalls: [
              {
                id: "call_1",
                function: {
                  name: "lookup_order",
                  arguments: '{"id":"A1"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
    });

    expect(response.messageId).toBe("cmpl_1");
    expect(response.choice).toEqual([
      AssistantContent.text("Use a reset link."),
      AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" }, "call_1"),
    ]);
    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      details: {
        input: 3,
        output: 4,
        total: 7,
      },
    });
  });

  it("maps Mistral token limits to the normalized length reason", () => {
    const response = fromMistralChatResponse({
      choices: [
        {
          index: 0,
          finishReason: "length",
          message: { content: '{"answer":"partial' },
        },
      ],
      usage: {},
    });

    expect(response).toMatchObject({
      finishReason: "length",
      providerFinishReason: "length",
    });
  });

  it("maps Mistral streaming chunks", () => {
    expect(
      fromMistralChatStreamChunk({
        id: "cmpl_1",
        choices: [
          {
            finishReason: "tool_calls",
            delta: {
              content: "Hello",
              toolCalls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "lookup",
                    arguments: '{"query"',
                  },
                },
              ],
            },
          },
        ],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    ).toEqual([
      { type: "text_delta", delta: "Hello" },
      {
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_1",
        name: "lookup",
        argumentsDelta: '{"query"',
      },
      { type: "message_id", id: "cmpl_1" },
      {
        type: "final",
        response: expect.objectContaining({
          messageId: "cmpl_1",
          finishReason: "tool-calls",
          providerFinishReason: "tool_calls",
          usage: {
            ...Usage.empty(),
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            details: {
              input: 1,
              output: 1,
              total: 2,
            },
          },
        }),
      },
    ]);
  });

  it("unwraps Mistral SDK completion event envelopes", async () => {
    const model = mistralModelWithChunks([
      {
        id: "cmpl_1",
        choices: [{ index: 0, delta: { content: "Hello" } }],
      },
      {
        id: "cmpl_1",
        choices: [{ index: 0, finishReason: "stop", delta: {} }],
        usage: { promptTokens: 2, completionTokens: 1 },
      },
    ]);

    const events: CompletionModelStreamEvent[] = [];
    for await (const event of model.streamCompletion({
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "message_id", id: "cmpl_1" },
      { type: "message_id", id: "cmpl_1" },
      {
        type: "final",
        response: expect.objectContaining({
          messageId: "cmpl_1",
          finishReason: "stop",
          providerFinishReason: "stop",
          usage: expect.objectContaining({ inputTokens: 2, outputTokens: 1, totalTokens: 3 }),
        }),
      },
    ]);
  });

  it("assembles the SDK placeholder-id and empty-name continuation shape", async () => {
    const model = mistralModelWithChunks([
      {
        id: "cmpl_1",
        choices: [
          {
            index: 0,
            delta: {
              toolCalls: [
                {
                  id: "tc-1",
                  index: 0,
                  type: "function",
                  function: { name: "lookup", arguments: '{"query"' },
                },
              ],
            },
          },
        ],
      },
      {
        id: "cmpl_1",
        choices: [
          {
            index: 0,
            finishReason: "tool_calls",
            delta: {
              toolCalls: [
                {
                  id: "null",
                  index: 0,
                  type: "function",
                  function: { name: "", arguments: ':"anvia"}' },
                },
              ],
            },
          },
        ],
        usage: { promptTokens: 2, completionTokens: 3 },
      },
    ]);

    const events: unknown[] = [];
    for await (const event of streamCompletion({ model, prompt: "lookup" })) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "final",
      result: {
        content: [AssistantContent.toolCall("tool_0", "lookup", { query: "anvia" }, "tc-1")],
        finishReason: "tool-calls",
      },
    });
  });

  it("creates Mistral chat completion models", async () => {
    const calls: unknown[] = [];
    const client = new MistralClient({
      client: {
        chat: {
          complete: async (params: unknown) => {
            calls.push(params);
            return {
              choices: [{ message: { content: "ok" } }],
              usage: {},
            };
          },
        },
      } as never,
    });

    await client.completionModel({ modelId: "mistral-test" }).completion({
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    });

    expect(calls).toEqual([
      {
        model: "mistral-test",
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
  });
});

function mistralModelWithChunks(chunks: unknown[]): MistralCompletionModel {
  return new MistralCompletionModel(
    {
      chat: {
        stream: async () =>
          (async function* () {
            for (const chunk of chunks) yield { data: chunk };
          })(),
      },
    } as never,
    "mistral-test",
  );
}

async function collectMistralStreamError(model: MistralCompletionModel): Promise<{
  error: unknown;
  events: CompletionModelStreamEvent[];
}> {
  const events: CompletionModelStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const event of model.streamCompletion({
      chatHistory: [Message.user("lookup")],
      documents: [],
      tools: [],
    })) {
      events.push(event);
    }
  } catch (caught) {
    error = caught;
  }
  return { error, events };
}
