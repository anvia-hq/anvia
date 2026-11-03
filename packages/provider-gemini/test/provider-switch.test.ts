import type { JsonObject, Message as MessageType } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { messagesToGeminiContents } from "../src/gemini/completion";

function assistantFrom(
  provider: string,
  content: Extract<MessageType, { role: "assistant" }>["content"],
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

describe("Gemini history after a provider switch", () => {
  it("does not send Anthropic thinking signatures as Gemini thought signatures", () => {
    const contents = messagesToGeminiContents([
      assistantFrom("anthropic", [
        {
          type: "reasoning",
          text: "Think.",
          details: [{ type: "text", text: "Think.", signature: "anthropic-sig" }],
        },
        { type: "text", text: "Answer." },
      ]),
    ]);

    expect(JSON.stringify(contents)).not.toContain("anthropic-sig");
    expect(contents).toEqual([{ role: "model", parts: [{ text: "Answer." }] }]);
  });

  it("keeps Gemini's own thought signatures when Gemini produced them", () => {
    const contents = messagesToGeminiContents([
      assistantFrom("gemini", [
        {
          type: "reasoning",
          text: "Think.",
          details: [{ type: "text", text: "Think.", signature: "gemini-sig" }],
        },
        { type: "text", text: "Answer." },
      ]),
    ]);

    expect(contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "Think.", thought: true, thoughtSignature: "gemini-sig" },
          { text: "Answer." },
        ],
      },
    ]);
  });
});
