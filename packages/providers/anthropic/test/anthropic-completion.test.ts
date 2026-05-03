import { AssistantContent, type CompletionRequest, Message, Usage, UserContent } from "@anvia/core";
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

  it("prepends normalized static context before chat history and maps system messages", () => {
    const request: CompletionRequest = {
      chatHistory: [Message.system("Use context."), Message.user("What is the owner?")],
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
});
