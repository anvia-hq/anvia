import { AgentBuilder } from "@anvia/core/agent";
import {
  AssistantContent,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  Message,
  ToolContent,
  Usage,
  UserContent,
} from "@anvia/core/completion";
import type { Tool } from "@anvia/core/tool";
import { describe, expect, it } from "vitest";
import {
  AnthropicCompletionModel,
  anthropicMessageHelpers,
  fromAnthropicMessage,
  fromAnthropicStreamEvent,
  toAnthropicMessagesParams,
} from "../src/anthropic/completion";

describe("Anthropic Messages mapping", () => {
  it("exposes Anthropic capability metadata", () => {
    const model = new AnthropicCompletionModel({} as never, "claude-test");

    expect(model.provider).toBe("anthropic");
    expect(model.defaultModel).toBe("claude-test");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: false,
      reasoning: true,
    });
  });

  it("rejects unsupported output schemas before provider calls", async () => {
    const calls: unknown[] = [];
    const model = new AnthropicCompletionModel(
      {
        messages: {
          create: async (params: unknown) => {
            calls.push(params);
            return {};
          },
        },
      } as never,
      "claude-test",
    );

    await expect(
      model.completion({
        chatHistory: [Message.user("hello")],
        documents: [],
        tools: [],
        outputSchema: { type: "object" },
      }),
    ).rejects.toThrow("anthropic:claude-test does not support output schemas.");
    expect(calls).toHaveLength(0);
  });

  it("maps internal tools and tool results to Anthropic params", () => {
    const request: CompletionRequest = {
      chatHistory: [
        Message.user("What is 2+5?"),
        Message.assistant([AssistantContent.toolCall("toolu_1", "add", { x: 2, y: 5 })]),
        Message.tool([
          { type: "tool_result", id: "toolu_1", content: [{ type: "text", text: "7" }] },
        ]),
      ],
      documents: [],
      tools: [
        {
          name: "add",
          description: "Add numbers",
          parameters: { type: "object" },
        },
      ],
      maxTokens: 256,
      temperature: 0.2,
      toolChoice: "auto",
    };

    const params = toAnthropicMessagesParams("claude-sonnet-4-20250514", request);

    expect(params.model).toBe("claude-sonnet-4-20250514");
    expect(params.tools).toEqual([
      {
        name: "add",
        description: "Add numbers",
        input_schema: { type: "object" },
      },
    ]);
    expect(params.messages).toContainEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "7" }],
    });
  });

  it("maps multimodal tool results to Anthropic content blocks", () => {
    const params = toAnthropicMessagesParams("claude-sonnet-4-20250514", {
      chatHistory: [
        Message.assistant([
          AssistantContent.toolCall("toolu_1", "computer_screenshot", {}, "fc_1"),
        ]),
        Message.tool(
          ToolContent.toolResult(
            "toolu_1",
            [
              { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
              { type: "image", data: "base64-png", mediaType: "image/png" },
            ],
            "fc_1",
          ),
        ),
      ],
      documents: [],
      tools: [],
    });

    expect(params.messages).toContainEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "fc_1",
          content: [
            { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "base64-png",
              },
            },
          ],
        },
      ],
    });
  });

  it("summarizes provider request metadata for traces", () => {
    const model = new AnthropicCompletionModel({} as never, "claude-test");
    const request: CompletionRequest = {
      instructions: "Be concise.",
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [{ name: "add", description: "Add numbers", parameters: { type: "object" } }],
      maxTokens: 256,
      toolChoice: "auto",
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "anthropic",
      api: "messages",
      stream: true,
      model: "claude-test",
      messageCount: 1,
      toolCount: 1,
      toolNames: ["add"],
      hasSystem: true,
      parameterKeys: expect.arrayContaining(["messages", "model", "stream", "system", "tools"]),
    });
  });

  it("prepends normalized static context before chat history and maps system messages", () => {
    const request: CompletionRequest = {
      chatHistory: [
        Message.system("Use context."),
        Message.user("What is the owner?", { metadata: { composer: { entities: [] } } }),
      ],
      documents: [{ id: "owner", text: "Mira owns launch checklists." }],
      tools: [],
    };

    const params = toAnthropicMessagesParams("claude-sonnet-4-20250514", request);

    expect(params.system).toBe("Use context.");
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "<file id: owner>\nMira owns launch checklists.\n</file>\n" },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "What is the owner?" }],
      },
    ]);
  });

  it("maps image and document attachments to Anthropic content blocks", () => {
    expect(
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.user([
          UserContent.text("Inspect these."),
          UserContent.imageUrl("https://example.com/image.png"),
          UserContent.imageBase64("abc123", "image/png"),
          UserContent.documentUrl("https://example.com/report.pdf", "application/pdf"),
          UserContent.documentBase64("pdf123", "application/pdf"),
          UserContent.documentText("Plain document text."),
        ]),
      ),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect these." },
          {
            type: "image",
            source: { type: "url", url: "https://example.com/image.png" },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "abc123" },
          },
          {
            type: "document",
            source: { type: "url", url: "https://example.com/report.pdf" },
          },
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "pdf123" },
          },
          { type: "text", text: "Plain document text." },
        ],
      },
    ]);
  });

  it("rejects unsupported Anthropic attachment history", () => {
    expect(() =>
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.user([UserContent.documentBase64("abc123", "text/csv")]),
      ),
    ).toThrow("Anthropic Messages only supports PDF document attachments");

    expect(() =>
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.assistant([AssistantContent.imageBase64("abc123", "image/png")]),
      ),
    ).toThrow("Anthropic Messages does not support image content in assistant history");
  });

  it("maps Anthropic tool_use blocks back to internal tool calls", () => {
    const response = fromAnthropicMessage({
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "add",
          input: { x: 2, y: 5 },
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
    });

    expect(response.choice).toEqual([AssistantContent.toolCall("toolu_1", "add", { x: 2, y: 5 })]);
    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 2,
    });
    expect(response.messageId).toBe("msg_1");
  });

  it("maps Anthropic thinking and redacted thinking blocks", () => {
    const response = fromAnthropicMessage({
      content: [
        {
          type: "thinking",
          thinking: "I should inspect the inputs.",
          signature: "sig_1",
        },
        {
          type: "redacted_thinking",
          data: "redacted",
        },
        {
          type: "text",
          text: "Done.",
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      {
        type: "reasoning",
        text: "I should inspect the inputs.",
        content: [{ type: "text", text: "I should inspect the inputs.", signature: "sig_1" }],
      },
      {
        type: "reasoning",
        text: "",
        content: [{ type: "redacted", data: "redacted" }],
      },
      AssistantContent.text("Done."),
    ]);
  });

  it("exposes helper conversion for assistant tool-use history", () => {
    expect(
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.assistant([AssistantContent.toolCall("toolu_1", "lookup", { query: "x" })]),
      ),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "lookup",
            input: { query: "x" },
          },
        ],
      },
    ]);
  });

  it("preserves structured thinking blocks in assistant history", () => {
    expect(
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.assistant([
          AssistantContent.reasoningFromContent([
            { type: "text", text: "Think.", signature: "sig_1" },
            { type: "redacted", data: "redacted" },
          ]),
          AssistantContent.toolCall("toolu_1", "lookup", { query: "x" }),
        ]),
      ),
    ).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Think.", signature: "sig_1" },
          { type: "redacted_thinking", data: "redacted" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "lookup",
            input: { query: "x" },
          },
        ],
      },
    ]);
  });

  it("maps Anthropic stream events to internal stream events", () => {
    expect(
      fromAnthropicStreamEvent({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      }),
    ).toEqual([{ type: "text_delta", delta: "hi" }]);

    expect(
      fromAnthropicStreamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Think." },
      }),
    ).toEqual([
      { type: "reasoning_delta", id: "thinking_0", delta: "Think.", contentType: "text" },
    ]);

    expect(
      fromAnthropicStreamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig_1" },
      }),
    ).toEqual([
      {
        type: "reasoning_delta",
        id: "thinking_0",
        delta: "",
        contentType: "text",
        signature: "sig_1",
      },
    ]);

    expect(
      fromAnthropicStreamEvent({
        type: "content_block_start",
        index: 1,
        content_block: { type: "redacted_thinking", data: "redacted" },
      }),
    ).toEqual([
      { type: "reasoning_delta", id: "thinking_1", delta: "redacted", contentType: "redacted" },
    ]);

    expect(
      fromAnthropicStreamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
      }),
    ).toEqual([{ type: "tool_call_delta", id: "toolu_1", name: "lookup" }]);
  });

  it("reports usage from normal streamed text responses with bare message_stop", async () => {
    const model = anthropicModelWithStreams([
      [
        {
          type: "message_start",
          message: {
            id: "msg_1",
            usage: { input_tokens: 10, cache_read_input_tokens: 3 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 4 },
        },
        { type: "message_stop" },
      ],
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    const events = await collect(agent.prompt("say hello").stream());

    expect(events).toContainEqual({
      type: "text_delta",
      turn: 1,
      delta: "Hello",
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      output: "Hello",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 3,
      },
    });
    expect(events.find((event) => event.type === "turn_end")).toMatchObject({
      type: "turn_end",
      response: { messageId: "msg_1" },
    });
  });

  it("preserves streamed cache usage fields", async () => {
    const response = finalResponseFrom(
      await collectStreamEvents([
        {
          type: "message_start",
          message: {
            id: "msg_1",
            usage: {
              input_tokens: 20,
              cache_read_input_tokens: 7,
              cache_creation_input_tokens: 5,
            },
          },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 6 },
        },
        { type: "message_stop" },
      ]),
    );

    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 20,
      outputTokens: 6,
      totalTokens: 26,
      cachedInputTokens: 7,
      cacheCreationInputTokens: 5,
    });
  });

  it("keeps thinking stream reasoning deltas and reports usage", async () => {
    const events = await collectStreamEvents([
      {
        type: "message_start",
        message: { id: "msg_1", usage: { input_tokens: 12 } },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Think." },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig_1" },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 8 },
      },
      { type: "message_stop" },
    ]);

    expect(events).toContainEqual({
      type: "reasoning_delta",
      id: "thinking_0",
      delta: "Think.",
      contentType: "text",
    });
    expect(events).toContainEqual({
      type: "reasoning_delta",
      id: "thinking_0",
      delta: "",
      contentType: "text",
      signature: "sig_1",
    });
    expect(finalResponseFrom(events).usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });
  });

  it("keeps streamed tool id remapping and reports usage", async () => {
    const events = await collectStreamEvents([
      {
        type: "message_start",
        message: { id: "msg_1", usage: { input_tokens: 15 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_write", name: "Write", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"file_path":"src/main.tsx"}' },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 9 },
      },
      { type: "message_stop" },
    ]);

    expect(events).toContainEqual({
      type: "tool_call_delta",
      id: "toolu_write",
      name: "Write",
    });
    expect(events).toContainEqual({
      type: "tool_call_delta",
      id: "toolu_write",
      argumentsDelta: '{"file_path":"src/main.tsx"}',
    });
    expect(finalResponseFrom(events).usage).toMatchObject({
      inputTokens: 15,
      outputTokens: 9,
      totalTokens: 24,
    });
  });

  it("keeps full message_stop.message handling while preserving streamed usage", async () => {
    const response = finalResponseFrom(
      await collectStreamEvents([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 10 } },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 4 },
        },
        {
          type: "message_stop",
          message: {
            id: "msg_1",
            content: [{ type: "text", text: "Full final text" }],
          },
        },
      ]),
    );

    expect(response.choice).toEqual([AssistantContent.text("Full final text")]);
    expect(response.messageId).toBe("msg_1");
    expect(response.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    });
  });

  it("keeps full message_stop.message usage fields not present in streamed usage", async () => {
    const response = finalResponseFrom(
      await collectStreamEvents([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 10 } },
        },
        {
          type: "message_stop",
          message: {
            id: "msg_1",
            content: [{ type: "text", text: "Full final text" }],
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              cache_read_input_tokens: 2,
              cache_creation_input_tokens: 1,
            },
          },
        },
      ]),
    );

    expect(response.choice).toEqual([AssistantContent.text("Full final text")]);
    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
    });
  });

  it("preserves complete tool input from streamed content_block_start events", async () => {
    const events = await collectStreamEvents([
      {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "tool_use",
          id: "toolu_write",
          name: "Write",
          input: {
            file_path: "src/main.tsx",
            content: "console.log('ok');",
          },
        },
      },
      { type: "content_block_stop", index: 2 },
    ]);

    expect(accumulatedToolArguments(events, "toolu_write")).toEqual({
      file_path: "src/main.tsx",
      content: "console.log('ok');",
    });
  });

  it("does not duplicate streamed tool input when input_json_delta also arrives", async () => {
    const events = await collectStreamEvents([
      {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "tool_use",
          id: "toolu_write",
          name: "Write",
          input: '{"file_path":"src/main.tsx","content":"start"}',
        },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "input_json_delta",
          partial_json: '{"file_path":"src/main.tsx","content":"delta"}',
        },
      },
      { type: "content_block_stop", index: 2 },
    ]);

    expect(
      events.filter(
        (event) => event.type === "tool_call_delta" && event.argumentsDelta !== undefined,
      ),
    ).toHaveLength(1);
    expect(accumulatedToolArguments(events, "toolu_write")).toEqual({
      file_path: "src/main.tsx",
      content: "start",
    });
  });

  it("keeps streamed input_json_delta tool arguments when the final message has empty tool input", async () => {
    const toolCalls: unknown[] = [];
    const model = anthropicModelWithStreams([
      [
        { type: "message_start", message: { id: "msg_1" } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "Write", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"file_path":"src/main.tsx","content":"hello"}',
          },
        },
        {
          type: "message_stop",
          message: {
            id: "msg_1",
            content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: {} }],
          },
        },
      ],
      finalTextStream(),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(writeTool(toolCalls)).build();

    const events = await collect(agent.prompt("write").stream());

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall("toolu_1", "Write", {
        file_path: "src/main.tsx",
        content: "hello",
      }),
    });
    expect(toolCalls).toEqual([{ file_path: "src/main.tsx", content: "hello" }]);
  });

  it("keeps streamed start-block tool arguments when the final message has empty tool input", async () => {
    const toolCalls: unknown[] = [];
    const model = anthropicModelWithStreams([
      [
        { type: "message_start", message: { id: "msg_1" } },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: { file_path: "src/main.tsx", content: "hello" },
          },
        },
        {
          type: "message_stop",
          message: {
            id: "msg_1",
            content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: {} }],
          },
        },
      ],
      finalTextStream(),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(writeTool(toolCalls)).build();

    const events = await collect(agent.prompt("write").stream());

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall("toolu_1", "Write", {
        file_path: "src/main.tsx",
        content: "hello",
      }),
    });
    expect(toolCalls).toEqual([{ file_path: "src/main.tsx", content: "hello" }]);
  });
});

async function collectStreamEvents(events: unknown[]): Promise<CompletionStreamEvent[]> {
  const model = new AnthropicCompletionModel(
    {
      messages: {
        create: async () => streamFrom(events),
      },
    } as never,
    "claude-test",
  );

  const mapped: CompletionStreamEvent[] = [];
  for await (const event of model.streamCompletion({
    chatHistory: [Message.user("write a file")],
    documents: [],
    tools: [],
  })) {
    mapped.push(event);
  }
  return mapped;
}

function finalResponseFrom(events: CompletionStreamEvent[]): CompletionResponse {
  const event = events.find(
    (item): item is Extract<CompletionStreamEvent, { type: "final" }> => item.type === "final",
  );
  if (event === undefined) {
    throw new Error("Expected final stream event");
  }
  return event.response;
}

function anthropicModelWithStreams(streams: unknown[][]): AnthropicCompletionModel {
  return new AnthropicCompletionModel(
    {
      messages: {
        create: async () => streamFrom(streams.shift() ?? []),
      },
    } as never,
    "claude-test",
  );
}

function writeTool(calls: unknown[]): Tool {
  return {
    name: "Write",
    definition() {
      return {
        name: "Write",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string" },
            content: { type: "string" },
          },
          required: ["file_path", "content"],
        },
      };
    },
    call(args) {
      calls.push(args);
      return "written";
    },
  };
}

function finalTextStream(): unknown[] {
  return [
    { type: "message_start", message: { id: "msg_2" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } },
    {
      type: "message_stop",
      message: {
        id: "msg_2",
        content: [{ type: "text", text: "done" }],
      },
    },
  ];
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

function accumulatedToolArguments(events: CompletionStreamEvent[], id: string): unknown {
  const argumentsText = events
    .flatMap((event) =>
      event.type === "tool_call_delta" && event.id === id && event.argumentsDelta !== undefined
        ? [event.argumentsDelta]
        : [],
    )
    .join("");
  return argumentsText.length === 0 ? {} : JSON.parse(argumentsText);
}
