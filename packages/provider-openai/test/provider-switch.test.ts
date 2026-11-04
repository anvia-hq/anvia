import type { JsonObject, Message as MessageType } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { openaiMessageHelpers } from "../src/openai/responses";

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

describe("OpenAI Responses history after a provider switch", () => {
  it("keeps the function_call id for OpenAI-origin history", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        assistantFrom("openai", [
          {
            type: "tool-call",
            toolCallId: "fc_1",
            callId: "call_1",
            toolName: "lookup",
            input: {},
          },
        ]),
      ),
    ).toEqual([
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "lookup",
        arguments: "{}",
      },
    ]);
  });

  it("does not send an Anthropic tool id as a Responses function_call id", () => {
    // Anthropic tool_use ids (toolu_...) come back as both toolCallId and callId.
    // OpenAI only accepts function_call ids that start with "fc", so the id must be dropped.
    const items = openaiMessageHelpers.messageToResponsesInput(
      assistantFrom("anthropic", [
        {
          type: "tool-call",
          toolCallId: "toolu_1",
          callId: "toolu_1",
          toolName: "lookup",
          input: { q: "x" },
        },
      ]),
    );

    expect(items).toEqual([
      {
        type: "function_call",
        call_id: "toolu_1",
        name: "lookup",
        arguments: '{"q":"x"}',
      },
    ]);
  });

  it("does not send a Chat Completions call id as a Responses function_call id", () => {
    // Chat Completions also reports provider "openai", but its call ids (call_...) are not
    // Responses item ids, so the id must be dropped for that history.
    const items = openaiMessageHelpers.messageToResponsesInput(
      assistantFrom("openai", [
        {
          type: "tool-call",
          toolCallId: "call_1",
          callId: "call_1",
          toolName: "lookup",
          input: {},
        },
      ]),
    );

    expect(items).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "lookup",
        arguments: "{}",
      },
    ]);
  });

  it("does not replay Anthropic thinking as a Responses reasoning item", () => {
    const items = openaiMessageHelpers.messageToResponsesInput(
      assistantFrom("anthropic", [
        {
          type: "reasoning",
          text: "Think.",
          details: [{ type: "text", text: "Think.", signature: "sig_1" }],
        },
        { type: "text", text: "Answer." },
      ]),
    );

    expect(items).toEqual([{ role: "assistant", content: "Answer." }]);
  });
});
