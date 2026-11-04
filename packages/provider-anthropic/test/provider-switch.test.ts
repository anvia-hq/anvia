import type { JsonObject, Message as MessageType } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { anthropicMessageHelpers, toAnthropicMessagesParams } from "../src/anthropic/completion";

function assistantFrom(
  provider: string,
  content: NonNullable<Extract<MessageType, { role: "assistant" }>["content"]>,
): MessageType {
  const metadata: JsonObject = {
    anvia: {
      generation: {
        provider,
        modelId: "model-x",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    },
  };
  return { role: "assistant", content, metadata };
}

describe("Anthropic history after a provider switch", () => {
  it("does not replay OpenAI reasoning items as Anthropic thinking blocks", () => {
    const messages = anthropicMessageHelpers.messageToAnthropicMessages(
      assistantFrom("openai", [
        {
          type: "reasoning",
          text: "Plan the lookup.",
          id: "rs_1",
          details: [
            { type: "text", text: "Plan the lookup." },
            { type: "summary", text: "Lookup plan" },
            { type: "encrypted", data: "enc-blob" },
          ],
        },
        { type: "tool-call", toolCallId: "fc_1", callId: "call_1", toolName: "lookup", input: {} },
      ]),
    );

    expect(JSON.stringify(messages)).not.toContain("thinking");
    expect(JSON.stringify(messages)).not.toContain("enc-blob");
    expect(messages).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "lookup", input: {} }],
      },
    ]);
  });

  it("does not replay Gemini thought signatures as Anthropic thinking signatures", () => {
    const messages = anthropicMessageHelpers.messageToAnthropicMessages(
      assistantFrom("gemini", [
        {
          type: "reasoning",
          text: "Considering options.",
          details: [{ type: "text", text: "Considering options.", signature: "gemini-sig" }],
        },
        { type: "text", text: "Answer." },
      ]),
    );

    expect(JSON.stringify(messages)).not.toContain("gemini-sig");
    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "Answer." }] }]);
  });

  it("drops reasoning-only foreign turns instead of sending an empty assistant message", () => {
    const messages = anthropicMessageHelpers.messageToAnthropicMessages(
      assistantFrom("openai", [
        {
          type: "reasoning",
          text: "",
          id: "rs_2",
          details: [{ type: "encrypted", data: "enc-only" }],
        },
      ]),
    );

    expect(messages).toEqual([]);
  });

  it("keeps Anthropic's own signed thinking when the same provider produced it", () => {
    expect(
      anthropicMessageHelpers.messageToAnthropicMessages(
        assistantFrom("anthropic", [
          {
            type: "reasoning",
            text: "Think.",
            details: [{ type: "text", text: "Think.", signature: "sig_1" }],
          },
          { type: "tool-call", toolCallId: "toolu_1", toolName: "lookup", input: {} },
        ]),
      ),
    ).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Think.", signature: "sig_1" },
          { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
        ],
      },
    ]);
  });

  it("keeps tool_use ids unique when a foreign history reuses a synthetic call id", () => {
    // Gemini names calls without ids gemini-tool-<part index>, so two turns can share an id.
    const params = toAnthropicMessagesParams("claude-sonnet-5", {
      chatHistory: [
        Message.user("first"),
        assistantFrom("gemini", [
          { type: "tool-call", toolCallId: "gemini-tool-0", toolName: "lookup", input: { q: 1 } },
        ]),
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "gemini-tool-0",
              toolName: "lookup",
              output: { type: "text", value: "one" },
            },
          ],
        },
        Message.user("again"),
        assistantFrom("gemini", [
          { type: "tool-call", toolCallId: "gemini-tool-0", toolName: "lookup", input: { q: 2 } },
        ]),
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "gemini-tool-0",
              toolName: "lookup",
              output: { type: "text", value: "two" },
            },
          ],
        },
      ],
      documents: [],
      tools: [],
    });

    const blocks = (params.messages as Array<{ content: unknown }>).flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    ) as Array<{ type: string; id?: string; tool_use_id?: string }>;
    const useIds = blocks.flatMap((block) => (block.type === "tool_use" ? [block.id] : []));
    const resultIds = blocks.flatMap((block) =>
      block.type === "tool_result" ? [block.tool_use_id] : [],
    );
    expect(new Set(useIds).size).toBe(useIds.length);
    expect(resultIds).toEqual(useIds);
  });

  it("never sends unsigned thinking, which Anthropic rejects", () => {
    const messages = anthropicMessageHelpers.messageToAnthropicMessages({
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "No signature here.",
          details: [{ type: "text", text: "No signature here." }],
        },
        { type: "text", text: "Done." },
      ],
    });

    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "Done." }] }]);
  });
});
