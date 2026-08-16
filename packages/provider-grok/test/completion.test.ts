import type { CompletionModelStreamEvent, CompletionRequest } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { GrokChatCompletionModel, GrokResponsesCompletionModel, tools } from "../src/index";

describe("Grok completion models", () => {
  it("exposes Responses capability metadata with Grok provider identity", () => {
    const model = new GrokResponsesCompletionModel({} as never, "grok-test");

    expect(model.provider).toBe("grok");
    expect(model.defaultModel).toBe("grok-test");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: true,
      providerTools: true,
    });
  });

  it("exposes model-specific context limits", () => {
    const model = new GrokResponsesCompletionModel({} as never, "grok-4.5");

    expect(model.getModelInfo()).toEqual({
      id: "grok-4.5",
      context: { contextWindow: 500_000 },
    });
  });

  it("uses canonical local and Grok tools instead of providerOptions.tools", async () => {
    const calls: unknown[] = [];
    const model = new GrokResponsesCompletionModel(
      {
        responses: {
          create: async (params: unknown) => {
            calls.push(params);
            return { output: [], usage: {} };
          },
        },
      } as never,
      "grok-test",
    );

    await model.completion({
      chatHistory: [Message.user("research")],
      documents: [],
      tools: [{ name: "local", description: "Local", parameters: { type: "object" } }],
      providerTools: [tools.webSearch({ allowedDomains: ["x.ai"] })],
      providerOptions: { tools: [{ type: "code_interpreter" }], max_turns: 5 },
    });

    expect(calls).toEqual([
      {
        model: "grok-test",
        input: [{ role: "user", content: "research" }],
        tools: [
          {
            type: "function",
            name: "local",
            description: "Local",
            parameters: { type: "object" },
          },
          { type: "web_search", filters: { allowed_domains: ["x.ai"] } },
        ],
        max_turns: 5,
      },
    ]);
  });

  it("rejects non-Grok provider tools", async () => {
    const model = new GrokResponsesCompletionModel({} as never, "grok-test");

    await expect(
      model.completion({
        chatHistory: [Message.user("research")],
        documents: [],
        tools: [],
        providerTools: [{ kind: "provider", provider: "other", name: "web_search" }],
      }),
    ).rejects.toThrow('provider tool "web_search" from "other"');
  });

  it("passes Grok Responses requests through the OpenAI-compatible adapter", async () => {
    const calls: unknown[] = [];
    const model = new GrokResponsesCompletionModel(
      {
        responses: {
          create: async (params: unknown) => {
            calls.push(params);
            return { output: [], usage: {} };
          },
        },
      } as never,
      "grok-test",
    );

    await model.completion({
      chatHistory: [Message.user("hello", { metadata: { composer: { entities: [] } } })],
      documents: [],
      tools: [],
      providerOptions: {
        reasoning: { effort: "high" },
      },
    });

    expect(calls).toEqual([
      {
        model: "grok-test",
        input: [{ role: "user", content: "hello" }],
        reasoning: { effort: "high" },
      },
    ]);
  });

  it("forwards Responses tool call deltas through the OpenAI-compatible adapter", async () => {
    const model = new GrokResponsesCompletionModel(
      {
        responses: {
          create: async () =>
            streamFrom([
              {
                type: "response.output_item.added",
                item: {
                  type: "function_call",
                  id: "tool_1",
                  call_id: "call_1",
                  name: "write_file",
                  arguments: "",
                },
              },
              {
                type: "response.function_call_arguments.delta",
                item_id: "tool_1",
                delta: '{"path":',
              },
              {
                type: "response.function_call_arguments.done",
                item_id: "tool_1",
                name: "write_file",
                arguments: '{"path":"README.md"}',
              },
            ]),
        },
      } as never,
      "grok-test",
    );

    const events = await collect(
      model.streamCompletion({
        chatHistory: [Message.user("write a file")],
        documents: [],
        tools: [],
      }),
    );

    expect(events).toContainEqual({
      type: "tool_call_delta",
      id: "tool_1",
      name: "write_file",
      argumentsDelta: '{"path":"README.md"}',
      argumentsMode: "replace",
    });
  });

  it("summarizes Responses traces with Grok provider identity", () => {
    const model = new GrokResponsesCompletionModel({} as never, "grok-test");
    const request: CompletionRequest = {
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [],
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "grok",
      api: "responses",
      stream: true,
      model: "grok-test",
    });
  });

  it("redacts remote MCP secrets from Responses traces", () => {
    const model = new GrokResponsesCompletionModel({} as never, "grok-test");
    const trace = model.traceRequest({
      chatHistory: [Message.user("research")],
      documents: [],
      tools: [],
      providerTools: [
        tools.mcp({
          serverUrl: "https://mcp.example.com",
          serverLabel: "example",
          authorization: "secret-token",
          headers: { "X-Secret": "secret-header" },
        }),
      ],
    });

    expect(JSON.stringify(trace)).not.toContain("secret-token");
    expect(JSON.stringify(trace)).not.toContain("secret-header");
    expect(trace).toMatchObject({ toolNames: ["mcp"], toolCount: 1 });
  });

  it("exposes Chat capability metadata with Grok provider identity", () => {
    const model = new GrokChatCompletionModel({} as never, "grok-chat-test");

    expect(model.provider).toBe("grok-chat");
    expect(model.defaultModel).toBe("grok-chat-test");
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

  it("summarizes Chat traces with Grok provider identity", () => {
    const model = new GrokChatCompletionModel({} as never, "grok-chat-test");
    const request: CompletionRequest = {
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [],
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "grok-chat",
      api: "chat.completions",
      stream: true,
      model: "grok-chat-test",
    });
  });

  it("omits message metadata from Grok Chat requests", async () => {
    const calls: unknown[] = [];
    const model = new GrokChatCompletionModel(
      {
        chat: {
          completions: {
            create: async (params: unknown) => {
              calls.push(params);
              return { choices: [{ message: { role: "assistant", content: "ok" } }], usage: {} };
            },
          },
        },
      } as never,
      "grok-chat-test",
    );

    await model.completion({
      chatHistory: [Message.user("hello", { metadata: { composer: { entities: [] } } })],
      documents: [],
      tools: [],
    });

    expect(calls).toEqual([
      {
        model: "grok-chat-test",
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
  });

  it("forwards Chat tool call deltas through the OpenAI-compatible adapter", async () => {
    const model = new GrokChatCompletionModel(
      {
        chat: {
          completions: {
            create: async () =>
              streamFrom([
                {
                  id: "chatcmpl_1",
                  choices: [
                    {
                      index: 0,
                      finish_reason: null,
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: "call_1",
                            function: { name: "write_file", arguments: '{"path":' },
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  id: "chatcmpl_1",
                  choices: [
                    {
                      index: 0,
                      finish_reason: "tool_calls",
                      delta: {
                        tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }],
                      },
                    },
                  ],
                },
              ]),
          },
        },
      } as never,
      "grok-chat-test",
    );

    const events = await collect(
      model.streamCompletion({
        chatHistory: [Message.user("write a file")],
        documents: [],
        tools: [],
      }),
    );

    expect(events.filter((event) => event.type === "tool_call_delta")).toEqual([
      {
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_1",
        name: "write_file",
        argumentsDelta: '{"path":',
      },
      {
        type: "tool_call_delta",
        id: "tool_0",
        argumentsDelta: '"README.md"}',
      },
    ]);
  });
});

async function* streamFrom(events: unknown[]): AsyncIterable<unknown> {
  yield* events;
}

async function collect(
  events: AsyncIterable<CompletionModelStreamEvent>,
): Promise<CompletionModelStreamEvent[]> {
  const result: CompletionModelStreamEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}
