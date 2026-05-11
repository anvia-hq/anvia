import {
  AssistantContent,
  type CompletionRequest,
  Message,
  ToolContent,
  UserContent,
} from "@anvia/core";
import { describe, expect, it } from "vitest";
import { OpenAIChatCompletionModel, OpenAIClient } from "../src/index";
import {
  fromOpenAIChatCompletionResponse,
  toOpenAIChatCompletionParams,
} from "../src/openai/chat-completion";

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
      chatHistory: [Message.user("hello")],
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
      AssistantContent.text("created"),
      AssistantContent.reasoning("provider reasoning text"),
    ]);
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
