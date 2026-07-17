import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AssistantContent,
  getAssistantGenerationMetadata,
  isJsonValue,
  type JsonValue,
  Message,
  type Message as MessageType,
  reasoningDisplayText,
  ToolContent,
  UserContent,
} from "./helpers/imports";

describe("message attachment content", () => {
  it("creates user image and document attachments", () => {
    expect(
      Message.user([
        UserContent.text("Inspect this."),
        UserContent.imageUrl("https://example.com/image.png", { detail: "auto" }),
        UserContent.imageBase64("abc123", "image/png", { detail: "high" }),
        UserContent.documentBase64("pdf123", "application/pdf", { filename: "report.pdf" }),
      ]),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Inspect this." },
        {
          type: "image",
          source: { type: "url", url: "https://example.com/image.png" },
          detail: "auto",
        },
        {
          type: "image",
          source: { type: "base64", data: "abc123", mediaType: "image/png" },
          detail: "high",
        },
        {
          type: "document",
          source: {
            type: "base64",
            data: "pdf123",
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        },
      ],
    });
  });

  it("creates assistant image history content", () => {
    expect(Message.assistant([AssistantContent.imageBase64("abc123", "image/png")])).toEqual({
      role: "assistant",
      content: [
        {
          type: "image",
          source: { type: "base64", data: "abc123", mediaType: "image/png" },
        },
      ],
    });
  });

  it("keeps legacy reasoning content shape and supports structured reasoning", () => {
    expect(AssistantContent.reasoning("Think once.", "rs_1")).toEqual({
      type: "reasoning",
      text: "Think once.",
      id: "rs_1",
    });

    const reasoning = AssistantContent.reasoningFromContent(
      [
        { type: "summary", text: "Checked the plan." },
        { type: "encrypted", data: "opaque" },
        { type: "text", text: "Visible thinking.", signature: "sig_1" },
        { type: "redacted", data: "redacted" },
      ],
      "rs_2",
    );

    expect(reasoning).toEqual({
      type: "reasoning",
      id: "rs_2",
      text: "Checked the plan.Visible thinking.",
      content: [
        { type: "summary", text: "Checked the plan." },
        { type: "encrypted", data: "opaque" },
        { type: "text", text: "Visible thinking.", signature: "sig_1" },
        { type: "redacted", data: "redacted" },
      ],
    });
    expect(reasoningDisplayText(reasoning)).toBe("Checked the plan.Visible thinking.");
  });

  it("creates a tool result message from string output", () => {
    expect(Message.toolResult("abc", "hello")).toEqual({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "abc",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
  });

  it("creates a tool result message from JSON-serializable output with callId", () => {
    expect(Message.toolResult("abc", { ok: true }, { callId: "call_123" })).toEqual({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "abc",
          callId: "call_123",
          content: [{ type: "text", text: '{"ok":true}' }],
        },
      ],
    });
  });

  it("creates a tool result message with toolName metadata", () => {
    expect(
      Message.toolResult("abc", { ok: true }, { callId: "call_123", toolName: "exec_command" }),
    ).toEqual({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "abc",
          callId: "call_123",
          toolName: "exec_command",
          content: [{ type: "text", text: '{"ok":true}' }],
        },
      ],
    });
  });

  it("supports positional tool result toolName metadata", () => {
    expect(ToolContent.toolResult("abc", "hello", undefined, "read_file")).toEqual({
      type: "tool_result",
      id: "abc",
      toolName: "read_file",
      content: [{ type: "text", text: "hello" }],
    });
    expect(ToolContent.toolResult("abc", "hello", "call_123", "read_file")).toEqual({
      type: "tool_result",
      id: "abc",
      callId: "call_123",
      toolName: "read_file",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("preserves structured tool result content", () => {
    expect(Message.toolResult("abc", [{ type: "text", text: "hello" }])).toEqual({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "abc",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
  });

  it("omits callId when no callId is provided", () => {
    const message = Message.toolResult("abc", "hello");

    expect(message.role).toBe("tool");
    if (message.role !== "tool") {
      throw new Error("Expected tool message");
    }
    expect(message).toMatchObject({
      role: "tool",
      content: [{ type: "tool_result", id: "abc" }],
    });
    const [toolResult] = message.content;
    expect(toolResult).toBeDefined();
    if (toolResult === undefined) {
      throw new Error("Expected tool result content");
    }
    expect("callId" in toolResult).toBe(false);
  });

  it("supports old and metadata-aware message factory signatures", () => {
    const metadata = { composer: { entities: [] } };
    const messages = [
      Message.system("system"),
      Message.system("system", { metadata }),
      Message.user("user"),
      Message.user("user", { metadata }),
      Message.assistant("assistant"),
      Message.assistant("assistant", "assistant_1"),
      Message.assistant("assistant", { id: "assistant_1", metadata }),
      Message.tool(ToolContent.toolResult("tool_1", "done")),
      Message.tool(ToolContent.toolResult("tool_1", "done"), { metadata }),
      Message.toolResult("tool_1", "done", {
        callId: "call_1",
        toolName: "lookup",
        metadata,
      }),
    ];

    expectTypeOf(messages).toMatchTypeOf<MessageType[]>();
    expect(messages[6]).toEqual({
      role: "assistant",
      id: "assistant_1",
      content: [{ type: "text", text: "assistant" }],
      metadata,
    });
    expect(messages[9]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "tool_1",
          callId: "call_1",
          toolName: "lookup",
          content: [{ type: "text", text: "done" }],
        },
      ],
      metadata,
    });
  });

  it("reads valid framework generation metadata without accepting malformed values", () => {
    const message = Message.assistant("assistant", {
      metadata: {
        anvia: {
          generation: {
            provider: "test",
            model: "test-model",
            usage: {
              inputTokens: 7,
              outputTokens: 2,
              totalTokens: 9,
              cachedInputTokens: 1,
              cacheCreationInputTokens: 0,
            },
          },
        },
      },
    });

    expect(getAssistantGenerationMetadata(message)).toEqual({
      provider: "test",
      model: "test-model",
      usage: {
        inputTokens: 7,
        outputTokens: 2,
        totalTokens: 9,
        cachedInputTokens: 1,
        cacheCreationInputTokens: 0,
      },
    });
    expect(getAssistantGenerationMetadata(Message.user("user"))).toBeUndefined();
    expect(
      getAssistantGenerationMetadata(
        Message.assistant("assistant", {
          metadata: {
            anvia: {
              generation: {
                provider: "test",
                model: "test-model",
                usage: { inputTokens: -1 },
              },
            },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("validates strict JSON values without accepting lossy structures", () => {
    const shared = { value: 1 };
    expect(isJsonValue({ shared, duplicate: shared, list: [null, true, 1, "ok"] })).toBe(true);
    expect(isJsonValue(Object.assign(Object.create(null), { value: "ok" }))).toBe(true);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = "value";
    const invalidValues = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      () => {},
      Symbol("value"),
      1n,
      cyclic,
      sparse,
      new Date(),
      { value: undefined },
    ];

    for (const value of invalidValues) {
      expect(isJsonValue(value)).toBe(false);
    }
  });

  it("rejects invalid runtime metadata at factory boundaries", () => {
    expect(() => Message.user("hello", { metadata: { score: Number.NaN } as JsonValue })).toThrow(
      "Message metadata must be a strict JSON value.",
    );
  });
});
