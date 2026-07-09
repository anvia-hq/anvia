import { describe, expect, it } from "vitest";

import {
  AssistantContent,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  coreMessagesToUIMessages,
  createCompletion,
  createCompletionStream,
  Message,
  type StreamingCompletionModel,
  type UIMessage,
  Usage,
  UserContent,
  uiMessagesToCoreMessages,
} from "./helpers/imports";

const capabilities: CompletionModelCapabilities = {
  streaming: true,
  tools: true,
  toolChoice: true,
  imageInput: true,
  documentInput: true,
  outputSchema: true,
  reasoning: true,
};

class StreamModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test-model";
  readonly capabilities = capabilities;
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly turns: CompletionStreamEvent[][]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return {
      choice: [AssistantContent.text("ok")],
      usage: Usage.empty(),
      rawResponse: {},
    };
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const turn = this.turns.shift() ?? [];
    for (const event of turn) {
      yield event;
    }
  }
}

describe("UI message adapters", () => {
  it("converts UI messages into core completion messages", () => {
    const messages: UIMessage[] = [
      {
        id: "user_1",
        role: "user",
        parts: [{ id: "part_1", type: "text", text: "Hello" }],
      },
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          { id: "part_2", type: "text", text: "Hi" },
          {
            id: "tool_call_1",
            type: "tool",
            toolName: "lookup",
            toolCallId: "call_1",
            state: "input-available",
            input: { query: "Anvia" },
          },
        ],
      },
    ];

    expect(uiMessagesToCoreMessages(messages)).toEqual([
      Message.user("Hello"),
      Message.assistant(
        [
          AssistantContent.text("Hi"),
          AssistantContent.toolCall("call_1", "lookup", { query: "Anvia" }),
        ],
        "assistant_1",
      ),
    ]);
  });

  it("preserves supported user data parts when converting back to core messages", () => {
    const coreMessages = [
      Message.user([
        UserContent.text("describe"),
        UserContent.imageUrl("https://example.test/image.png"),
      ]),
    ];

    expect(uiMessagesToCoreMessages(coreMessagesToUIMessages(coreMessages))).toEqual(coreMessages);
  });

  it("converts user attachment parts into core multimodal content", () => {
    const messages: UIMessage[] = [
      {
        id: "user_1",
        role: "user",
        parts: [
          { id: "text_1", type: "text", text: "review" },
          {
            id: "attachment_1",
            type: "attachment",
            attachment: {
              id: "image_1",
              type: "image",
              url: "https://example.test/image.png",
              detail: "high",
            },
          },
          {
            id: "attachment_2",
            type: "attachment",
            attachment: {
              id: "doc_1",
              type: "document",
              name: "brief.txt",
              mediaType: "text/plain",
              text: "details",
            },
          },
        ],
      },
    ];

    expect(uiMessagesToCoreMessages(messages)).toEqual([
      Message.user([
        UserContent.text("review"),
        UserContent.imageUrl("https://example.test/image.png", { detail: "high" }),
        {
          type: "document",
          source: {
            type: "text",
            text: "details",
            mediaType: "text/plain",
            filename: "brief.txt",
          },
        },
      ]),
    ]);
  });

  it("rejects unsupported user UI parts instead of dropping them", () => {
    const messages: UIMessage[] = [
      {
        id: "user_1",
        role: "user",
        parts: [{ id: "custom_1", type: "data", name: "custom", data: { value: 1 } }],
      },
    ];

    expect(() => uiMessagesToCoreMessages(messages)).toThrow(
      "User UI messages can only be converted from text, attachment, or image/document data parts.",
    );
  });

  it("preserves completed assistant tool parts as core tool results", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          {
            id: "tool_tool_1",
            type: "tool",
            toolName: "add",
            toolCallId: "tool_1",
            callId: "call_1",
            state: "output-available",
            input: { x: 2, y: 5 },
            output: "7",
          },
        ],
      },
    ];

    const coreMessages = uiMessagesToCoreMessages(messages);

    expect(coreMessages).toEqual([
      Message.assistant(
        [AssistantContent.toolCall("tool_1", "add", { x: 2, y: 5 }, "call_1")],
        "assistant_1",
      ),
      Message.toolResult("tool_1", "7", { callId: "call_1", toolName: "add" }),
    ]);

    const hydrated = coreMessagesToUIMessages(coreMessages);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "add",
      toolCallId: "tool_1",
      callId: "call_1",
      state: "output-available",
      input: { x: 2, y: 5 },
      output: "7",
    });
    expect(uiMessagesToCoreMessages(hydrated)).toEqual(coreMessages);
  });

  it("merges persisted tool results by tool call id", () => {
    const messages = coreMessagesToUIMessages([
      Message.assistant([
        AssistantContent.toolCall("abc", "exec_command", { cmd: "pwd" }, "call_1"),
      ]),
      Message.toolResult("abc", "done", { callId: "call_1" }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "exec_command",
      toolCallId: "abc",
      callId: "call_1",
      state: "output-available",
      input: { cmd: "pwd" },
      output: "done",
    });
  });

  it("merges persisted tool results by provider callId", () => {
    const messages = coreMessagesToUIMessages([
      Message.assistant([
        AssistantContent.toolCall("internal_1", "read_file", { path: "README.md" }, "call_1"),
      ]),
      Message.toolResult("legacy_result", "done", { callId: "call_1" }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "read_file",
      toolCallId: "internal_1",
      callId: "call_1",
      state: "output-available",
      input: { path: "README.md" },
      output: "done",
    });
  });

  it("uses stored tool result names before falling back to lookup", () => {
    const messages = coreMessagesToUIMessages([
      Message.toolResult("orphan_result", "done", { toolName: "write_file" }),
    ]);

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "write_file",
      toolCallId: "orphan_result",
      state: "output-available",
      output: "done",
    });
  });

  it("falls back to a generic tool name for unmatched legacy tool results", () => {
    const messages = coreMessagesToUIMessages([Message.toolResult("orphan_result", "done")]);

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "tool",
      toolCallId: "orphan_result",
      state: "output-available",
      output: "done",
    });
  });

  it("accepts core messages in createCompletionStream options", async () => {
    const model = new StreamModel([
      [
        {
          type: "final",
          response: {
            choice: [AssistantContent.text("Hello")],
            usage: Usage.empty(),
            rawResponse: {},
          },
        },
      ],
    ]);

    await collect(
      createCompletionStream(model, {
        messages: [Message.user("Hello")],
      }),
    );

    expect(model.requests[0]?.chatHistory).toEqual([Message.user("Hello")]);
  });

  it("accepts a core message as createCompletion input", async () => {
    const model = new StreamModel([]);

    const result = await createCompletion(model, {
      input: Message.user("Hello"),
    });

    expect(result.text).toBe("ok");
    expect(model.requests[0]?.chatHistory).toEqual([Message.user("Hello")]);
  });

  it("rejects non-core message arrays", () => {
    const model = new StreamModel([]);
    const uiMessage: UIMessage = {
      id: "user_1",
      role: "user",
      parts: [{ id: "part_1", type: "text", text: "Hello" }],
    };

    expect(() =>
      createCompletionStream(model, {
        messages: [Message.user("Hi"), uiMessage] as never,
      }),
    ).toThrow("messages must contain only Message values.");
  });

  it("rejects malformed single message input", () => {
    const model = new StreamModel([]);

    expect(() =>
      createCompletionStream(model, {
        input: { role: "user", content: "Hello" } as never,
      }),
    ).toThrow("input must be a string, Message, or Message[].");
  });
});

async function collect<TEvent>(events: AsyncIterable<TEvent>): Promise<TEvent[]> {
  const collected: TEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
