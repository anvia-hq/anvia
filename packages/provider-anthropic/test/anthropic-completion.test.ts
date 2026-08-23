import { Agent } from "@anvia/core/agent";
import {
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core/completion";
import type { Tool } from "@anvia/core/tool";
import { describe, expect, it } from "vitest";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import {
  AnthropicCompletionModel,
  anthropicMessageHelpers,
  fromAnthropicMessage,
  fromAnthropicStreamEvent,
  toAnthropicMessagesParams,
} from "../src/anthropic/completion";
import { AnthropicClient } from "../src/index";

describe("Anthropic Messages mapping", () => {
  it("exposes Anthropic capability metadata", () => {
    const model = new AnthropicCompletionModel({} as never, "claude-test");

    expect(model.provider).toBe("anthropic");
    expect(model.modelId).toBe("claude-test");
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

  it("exposes model-specific context limits", () => {
    const model = new AnthropicClient({ client: {} as never }).completionModel({
      modelId: "claude-opus-5",
    });

    expect(model.contextLimits).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 128_000 });
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

  it("marks failed and denied tool results as errors", () => {
    const params = toAnthropicMessagesParams("claude-sonnet-4-20250514", {
      chatHistory: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool_error",
              toolName: "lookup",
              output: { type: "error-json", value: { code: "FAILED" } },
            },
            {
              type: "tool-result",
              toolCallId: "tool_denied",
              toolName: "delete",
              output: { type: "execution-denied", reason: "Not allowed." },
            },
          ],
        },
      ],
      documents: [],
      tools: [],
    });

    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_error",
            content: '{"code":"FAILED"}',
            is_error: true,
          },
          {
            type: "tool_result",
            tool_use_id: "tool_denied",
            content: "Not allowed.",
            is_error: true,
          },
        ],
      },
    ]);
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
              {
                type: "file",
                data: { type: "data", data: "base64-png" },
                mediaType: "image/png",
              },
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
        content: "<file id: owner>\nMira owns launch checklists.\n</file>\n",
      },
      {
        role: "user",
        content: "What is the owner?",
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
    ).toThrow("Anthropic Messages only supports image and PDF file attachments");

    expect(() =>
      anthropicMessageHelpers.messageToAnthropicMessages(
        Message.assistant([AssistantContent.imageBase64("abc123", "image/png")]),
      ),
    ).toThrow("Anthropic Messages does not support image or file content in assistant history");
  });

  it("maps Anthropic tool_use blocks back to internal tool calls", () => {
    const response = fromAnthropicMessage({
      id: "msg_1",
      stop_reason: "tool_use",
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

    expect(response.choice).toEqual([
      AssistantContent.toolCall("toolu_1", "add", { x: 2, y: 5 }, "toolu_1"),
    ]);
    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 20,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 2,
      details: {
        input: 10,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output: 5,
        total: 20,
      },
    });
    expect(response.messageId).toBe("msg_1");
  });

  it("rejects missing or blank Anthropic tool identities", () => {
    for (const block of [
      { type: "tool_use", name: "add", input: {} },
      { type: "tool_use", id: "   ", name: "add", input: {} },
      { type: "tool_use", id: "toolu_1", input: {} },
      { type: "tool_use", id: "toolu_1", name: "\t", input: {} },
    ]) {
      expect(
        thrownProviderOutputError(() =>
          fromAnthropicMessage({ stop_reason: "tool_use", content: [block], usage: {} }),
        ),
      ).toMatchObject({ kind: "invalid-tool-call" });
    }
  });

  it("rejects Anthropic tool input that is not deeply JSON-safe", () => {
    const invalidInputs = [
      { nested: { missing: undefined } },
      { nested: Number.POSITIVE_INFINITY },
      new Date("2026-01-01T00:00:00.000Z"),
      Symbol("unsupported-tool-input"),
    ];

    for (const input of invalidInputs) {
      expect(
        thrownProviderOutputError(() =>
          fromAnthropicMessage({
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "add", input }],
            usage: {},
          }),
        ),
      ).toMatchObject({ kind: "invalid-tool-arguments", toolCallId: "toolu_1" });
    }
  });

  it("maps Anthropic output limits to the normalized length reason", () => {
    const response = fromAnthropicMessage({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"answer":"partial' }],
      usage: {},
    });

    expect(response).toMatchObject({
      finishReason: "length",
      providerFinishReason: "max_tokens",
    });
  });

  it.each([
    ["max_tokens", "truncated-tool-call", "length"],
    ["refusal", "filtered-tool-call", "content-filter"],
    ["end_turn", "invalid-tool-call", "stop"],
    ["pause_turn", "invalid-tool-call", "other"],
  ] as const)("rejects %s responses that contain tool calls", (stopReason, kind, finishReason) => {
    expect(
      thrownProviderOutputError(() =>
        fromAnthropicMessage({
          stop_reason: stopReason,
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Write",
              input: { file_path: "src/main.tsx", content: "hello" },
            },
          ],
          usage: {},
        }),
      ),
    ).toMatchObject({ kind, finishReason });
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
        details: [{ type: "text", text: "I should inspect the inputs.", signature: "sig_1" }],
      },
      {
        type: "reasoning",
        text: "",
        details: [{ type: "redacted", data: "redacted" }],
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
    const agent = new Agent({ id: "test-agent", model });

    const events = await collect(agent.stream({ prompt: "say hello" }));

    expect(events).toContainEqual({
      type: "text_delta",
      turn: 1,
      delta: "Hello",
    });
    expect(events.at(-1)).toMatchObject({
      type: "response",
      output: "Hello",
      usage: {
        inputTokens: 13,
        outputTokens: 4,
        totalTokens: 17,
        cachedInputTokens: 3,
      },
    });
    expect(events.find((event) => event.type === "turn_end")).toMatchObject({
      type: "turn_end",
      response: {
        messageId: "msg_1",
        finishReason: "stop",
        providerFinishReason: "end_turn",
      },
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
      inputTokens: 32,
      outputTokens: 6,
      totalTokens: 38,
      cachedInputTokens: 7,
      cacheCreationInputTokens: 5,
      details: {
        input: 20,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 5,
        output: 6,
        total: 38,
      },
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
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
      details: {
        input: 10,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
        output: 4,
        total: 17,
      },
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
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} },
      { type: "message_stop" },
    ]);

    expect(accumulatedToolArguments(events, "toolu_write")).toEqual({
      file_path: "src/main.tsx",
      content: "console.log('ok');",
    });
  });

  it("rejects argument deltas after complete start-block tool input", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "tool_use",
            id: "toolu_write",
            name: "Write",
            input: { file_path: "src/main.tsx", content: "start" },
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
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-arguments",
      toolCallId: "toolu_write",
    });
  });

  it("rejects malformed native start-block input instead of replacing it with partial_json", async () => {
    const toolCalls: unknown[] = [];
    const model = anthropicModelWithStreams([
      [
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: "not-json",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"file_path":"src/main.tsx","content":"hello"}',
          },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} },
        { type: "message_stop" },
      ],
      finalTextStream(),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [writeTool(toolCalls)] });

    const events = await collect(agent.stream({ prompt: "write" }));

    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: {
        name: "CompletionProviderOutputError",
        kind: "invalid-tool-arguments",
        toolCallId: "toolu_1",
      },
    });
    expect(toolCalls).toEqual([]);
  });

  it("rejects a serialized JSON prefix in native start-block input", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: '{"file_path":',
          },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-arguments",
      toolCallId: "toolu_1",
    });
  });

  it("rejects malformed streamed tool arguments instead of quoting them", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: "not-json",
          },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-arguments",
      toolCallId: "toolu_1",
    });
  });

  it("rejects input_json_delta after its tool content block has closed", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: {},
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{}" },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      toolCallId: "toolu_1",
    });
  });

  it.each(["   ", ""])(
    "rejects an explicit %j tool argument fragment instead of treating it as absent",
    async (partialJson) => {
      await expect(
        collectStreamEvents([
          {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "toolu_1",
              name: "Write",
              input: {},
            },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: partialJson },
          },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} },
          { type: "message_stop" },
        ]),
      ).rejects.toMatchObject({
        name: "CompletionProviderOutputError",
        kind: "malformed-tool-arguments",
        toolCallId: "toolu_1",
      });
    },
  );

  it("emits explicit empty-object arguments for a legitimate no-argument tool", async () => {
    const events = await collectStreamEvents([
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "NoArgs",
          input: {},
        },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} },
      { type: "message_stop" },
    ]);

    expect(events).toContainEqual({
      type: "tool_call_delta",
      id: "toolu_1",
      argumentsDelta: "{}",
    });
    expect(finalResponseFrom(events)).toMatchObject({ finishReason: "tool-calls" });
  });

  it("rejects streamed tool progress terminated by end_turn", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "NoArgs",
            input: {},
          },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
        { type: "message_stop" },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      finishReason: "stop",
    });
  });

  it("classifies an unsafe final-message tool marker before parsing malformed tool fields", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "message_stop",
          message: {
            stop_reason: "max_tokens",
            content: [{ type: "tool_use", id: 42, name: null, input: "{" }],
            usage: { input_tokens: 5, output_tokens: 8 },
          },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "truncated-tool-call",
      finishReason: "length",
      usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13 },
    });
  });

  it("rejects a final message whose stop reason contradicts the streamed stop reason", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 8 },
        },
        {
          type: "message_stop",
          message: {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "NoArgs", input: {} }],
          },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      usage: { outputTokens: 8 },
    });
  });

  it("blocks max_tokens tool calls before execution", async () => {
    const toolCalls: unknown[] = [];
    const model = anthropicModelWithStreams([
      [
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Write",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"file_path":"src/main.tsx","content":',
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 8 },
        },
        { type: "message_stop" },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [writeTool(toolCalls)] });

    const events = await collect(agent.stream({ prompt: "write" }));

    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: {
        name: "CompletionProviderOutputError",
        kind: "truncated-tool-call",
        finishReason: "length",
      },
    });
    expect(toolCalls).toEqual([]);
  });

  it("blocks tool calls when the Anthropic stream has no terminal event", async () => {
    const toolCalls: unknown[] = [];
    const model = anthropicModelWithStreams([
      [
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
        { type: "content_block_stop", index: 0 },
      ],
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [writeTool(toolCalls)] });

    const events = await collect(agent.stream({ prompt: "write" }));

    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: {
        name: "CompletionProviderOutputError",
        kind: "incomplete-stream",
      },
    });
    expect(toolCalls).toEqual([]);
  });

  it("accepts streamed tool arguments when the final message agrees exactly", async () => {
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
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Write",
                input: { file_path: "src/main.tsx", content: "hello" },
              },
            ],
          },
        },
      ],
      finalTextStream(),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [writeTool(toolCalls)] });

    const events = await collect(agent.stream({ prompt: "write" }));

    expect(events).toContainEqual({
      type: "tool_call",
      turn: 1,
      toolCall: AssistantContent.toolCall(
        "toolu_1",
        "Write",
        { file_path: "src/main.tsx", content: "hello" },
        "toolu_1",
      ),
    });
    expect(toolCalls).toEqual([{ file_path: "src/main.tsx", content: "hello" }]);
  });

  it("rejects a final tool input that contradicts complete streamed input", async () => {
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
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: {} }],
          },
        },
      ],
      finalTextStream(),
    ]);
    const agent = new Agent({ id: "test-agent", model, tools: [writeTool(toolCalls)] });

    const events = await collect(agent.stream({ prompt: "write" }));

    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: {
        name: "CompletionProviderOutputError",
        kind: "invalid-tool-call",
        toolCallId: "toolu_1",
      },
    });
    expect(toolCalls).toEqual([]);
  });

  it("rejects conflicting streamed finish reasons", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 2 },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
    });
  });

  it("rejects semantic progress after a streamed finish reason", async () => {
    await expect(
      collectStreamEvents([
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "late" },
        },
      ]),
    ).rejects.toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
    });
  });
});

async function collectStreamEvents(events: unknown[]): Promise<CompletionModelStreamEvent[]> {
  const model = new AnthropicCompletionModel(
    {
      messages: {
        create: async () => streamFrom(events),
      },
    } as never,
    "claude-test",
  );

  const mapped: CompletionModelStreamEvent[] = [];
  for await (const event of model.streamCompletion({
    chatHistory: [Message.user("write a file")],
    documents: [],
    tools: [],
  })) {
    mapped.push(event);
  }
  return mapped;
}

function finalResponseFrom(events: CompletionModelStreamEvent[]): CompletionResponse {
  const event = events.find(
    (item): item is Extract<CompletionModelStreamEvent, { type: "final" }> => item.type === "final",
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

function accumulatedToolArguments(events: CompletionModelStreamEvent[], id: string): unknown {
  const argumentsText = events
    .flatMap((event) =>
      event.type === "tool_call_delta" && event.id === id && event.argumentsDelta !== undefined
        ? [event.argumentsDelta]
        : [],
    )
    .join("");
  return argumentsText.length === 0 ? {} : JSON.parse(argumentsText);
}

function thrownProviderOutputError(call: () => unknown): CompletionProviderOutputError {
  try {
    call();
  } catch (error) {
    if (error instanceof CompletionProviderOutputError) return error;
    throw error;
  }
  throw new Error("Expected CompletionProviderOutputError");
}
