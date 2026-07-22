import {
  type CompletionRequest,
  type CompletionStreamEvent,
  Message,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { GrokChatCompletionModel, GrokResponsesCompletionModel } from "../src/index";

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
    });
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
      additionalParams: {
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
  events: AsyncIterable<CompletionStreamEvent>,
): Promise<CompletionStreamEvent[]> {
  const result: CompletionStreamEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}
