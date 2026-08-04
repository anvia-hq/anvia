import {
  AssistantContent,
  type CompletionRequest,
  Message,
  ToolContent,
  Usage,
  UserContent,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  fromMistralChatResponse,
  fromMistralChatStreamChunk,
  MistralClient,
  MistralCompletionModel,
  mistralMessageHelpers,
  toMistralChatParams,
} from "../src/index";

describe("Mistral completion mapping", () => {
  it("exposes Mistral capability metadata", () => {
    const model = new MistralCompletionModel({} as never, "mistral-test");

    expect(model.provider).toBe("mistral");
    expect(model.defaultModel).toBe("mistral-test");
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
    const model = new MistralCompletionModel({} as never, "mistral-large-latest");

    expect(model.getModelInfo()).toEqual({
      id: "mistral-large-latest",
      context: { contextWindow: 262_144, maxOutputTokens: 262_144 },
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
      additionalParams: {
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
      temperature: 0.4,
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
      additionalParams: {
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

  it("falls back to the tool call id for the tool message name when no tool name is set", () => {
    expect(
      mistralMessageHelpers.messageToMistralMessages(
        Message.tool(ToolContent.toolResult("call_1", "shipped")),
      ),
    ).toEqual([
      {
        role: "tool",
        toolCallId: "call_1",
        name: "call_1",
        content: "shipped",
      },
    ]);
  });

  it("throws on malformed tool call arguments instead of coercing them", () => {
    expect(() =>
      fromMistralChatResponse({
        choices: [
          {
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
    ).toThrow('Mistral returned tool call "call_1" with malformed JSON arguments');
  });

  it("derives deterministic ids for tool calls missing an id", () => {
    const response = fromMistralChatResponse({
      id: "cmpl_9",
      choices: [
        {
          message: {
            toolCalls: [
              { function: { name: "first", arguments: "{}" } },
              { function: { name: "second", arguments: "{}" } },
            ],
          },
        },
      ],
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("cmpl_9-tool-0", "first", {}),
      AssistantContent.toolCall("cmpl_9-tool-1", "second", {}),
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
      AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" }),
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

  it("maps Mistral streaming chunks", () => {
    expect(
      fromMistralChatStreamChunk({
        id: "cmpl_1",
        choices: [
          {
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

    await client.completionModel("mistral-test").completion({
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
