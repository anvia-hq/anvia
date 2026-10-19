import { expect, test } from "vitest";
import {
  agentToClientStream,
  applyClientStreamEvent,
  messageText,
  parseClientStreamEvent,
  type UIMessage,
} from "../src";
import { Usage, type AgentStreamEvent, type ToolCallPart } from "@anvia/core";

test("a restarted generation clears partial content while keeping completed turns", async () => {
  const generation = (turn: number): AgentStreamEvent<string> => ({
    type: "generation_start",
    turn,
    request: { chatHistory: [], documents: [], tools: [] },
    modelInfo: { provider: "fixture", modelId: "fixture" },
  });
  const committed: ToolCallPart = {
    type: "tool-call",
    toolCallId: "committed",
    toolName: "shell",
    input: { command: "echo committed" },
  };
  const source = { type: "url" as const, url: "https://example.com/shared" };
  async function* events(): AsyncIterable<AgentStreamEvent<string>> {
    yield generation(1);
    yield { type: "tool_call", turn: 1, toolCall: committed };
    yield {
      type: "turn_end",
      turn: 1,
      response: {
        choice: [committed],
        usage: Usage.empty(),
        rawResponse: null,
      },
    };
    yield {
      type: "tool_result",
      turn: 1,
      toolCallId: "committed",
      toolName: "shell",
      internalCallId: "committed",
      args: "{}",
      output: { type: "text", value: "committed" },
      result: "committed",
    };
    yield generation(2);
    yield { type: "text_delta", turn: 2, delta: "obsolete text" };
    yield {
      type: "reasoning_delta",
      turn: 2,
      id: "reason",
      delta: "obsolete reasoning",
    };
    yield { type: "source", turn: 2, source };
    yield {
      type: "source",
      turn: 2,
      source: { type: "url", url: "https://example.com/obsolete" },
    };
    yield {
      type: "tool_call_delta",
      turn: 2,
      id: "pending",
      name: "shell",
      argumentsDelta: "broken",
    };
    yield generation(2);
    yield { type: "text_delta", turn: 2, delta: "fresh " };
    yield {
      type: "reasoning_delta",
      turn: 2,
      id: "reason",
      delta: "fresh reasoning",
    };
    yield { type: "source", turn: 2, source };
    yield {
      type: "tool_call_delta",
      turn: 2,
      id: "pending",
      name: "shell",
      argumentsDelta: "{}",
    };
    yield { type: "text_delta", turn: 2, delta: "answer" };
    yield {
      type: "turn_end",
      turn: 2,
      response: {
        choice: [
          { type: "text", text: "fresh answer" },
          { type: "reasoning", id: "reason", text: "fresh reasoning" },
          {
            type: "tool-call",
            toolCallId: "pending",
            toolName: "shell",
            input: {},
          },
        ],
        sources: [source],
        usage: Usage.empty(),
        rawResponse: null,
      },
    };
    yield {
      type: "response",
      runId: "test",
      text: "fresh answer",
      output: "fresh answer",
      usage: Usage.empty(),
      messages: [],
    };
  }
  let messages: readonly UIMessage[] = [];
  let resets = 0;
  let sharedSources = 0;
  let retryMessageId: string | undefined;
  for await (const event of agentToClientStream({ events: events() })) {
    messages = applyClientStreamEvent(messages, parseClientStreamEvent(event));
    if (event.type === "source" && event.source.url === source.url) sharedSources++;
    if (event.type === "message_start" && event.turn === 2) retryMessageId = event.messageId;
    if (event.type === "message_reset") {
      expect(event.messageId).toBe(retryMessageId);
      resets++;
      expect(messages[1]!.parts).toEqual([]);
      expect(messages[0]!.parts[0]).toMatchObject({
        type: "tool",
        state: "output-available",
      });
    }
    if (event.type === "text_delta" && event.delta === "fresh ") {
      expect(messageText(messages[1]!)).toBe("fresh ");
      expect(JSON.stringify(messages[1])).not.toContain("obsolete");
    }
    if (event.type === "tool_call_delta" && event.delta === "{}")
      expect(messages[1]!.parts.find((part) => part.type === "tool")).toMatchObject({
        input: "{}",
      });
  }
  expect(resets).toBe(1);
  expect(sharedSources).toBe(2);
  expect(messages).toHaveLength(2);
  expect(messageText(messages[1]!)).toBe("fresh answer");
  expect(JSON.stringify(messages)).not.toContain("obsolete");
});

test("message resets validate identity and preserve unrelated or scoped messages", () => {
  const event = { type: "message_reset", runId: "run", messageId: "retry" } as const;
  expect(parseClientStreamEvent(event)).toEqual(event);
  for (const invalid of [
    { ...event, messageId: undefined },
    { ...event, messageId: 1 },
    { ...event, extra: true },
  ])
    expect(() => parseClientStreamEvent(invalid)).toThrow();
  const previous: UIMessage = { id: "previous", role: "assistant", parts: [] };
  const retry: UIMessage = {
    id: "retry",
    role: "assistant",
    parts: [],
    metadata: { stale: true },
    modelMessageId: "stale",
    generation: { status: "error" },
  };
  const messages = [previous, retry];
  const updated = applyClientStreamEvent(messages, event);
  expect(updated[0]).toBe(previous);
  expect(updated[1]).toEqual({ id: "retry", role: "assistant", parts: [] });
  expect(applyClientStreamEvent(messages, { ...event, scope: { parentToolCallId: "child" } })).toBe(
    messages,
  );
});
