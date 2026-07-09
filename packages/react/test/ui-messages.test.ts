import { AssistantContent, Message } from "@anvia/core/completion";
import { coreMessagesToUIMessages, type UIMessage, type UIMessagePart } from "@anvia/core/ui";
import { describe, expect, it } from "vitest";

import { applyAnviaStreamEvent } from "../src/ui-messages";

type UIToolPart = Extract<UIMessagePart, { type: "tool" }>;

describe("@anvia/react UI message reducer", () => {
  it("keeps reused provider tool ids isolated across turns", () => {
    let messages: UIMessage[] = [];
    const events = [
      { type: "reasoning_delta", turn: 1, delta: "I need to search first." },
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("call_0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      },
      {
        type: "tool_result",
        turn: 1,
        toolName: "webSearch",
        internalCallId: "internal_search_1",
        toolCallId: "call_0",
        args: '{"query":"AAPL stock price market analysis 2025"}',
        result: "search results...",
        structuredResult: {
          query: "AAPL stock price market analysis 2025",
          results: [],
        },
      },
      { type: "reasoning_delta", turn: 2, delta: "Now I need to create a folder." },
      {
        type: "tool_call",
        turn: 2,
        toolCall: AssistantContent.toolCall("call_0", "exec_command", {
          cmd: "mkdir -p report",
        }),
      },
      {
        type: "tool_result",
        turn: 2,
        toolName: "exec_command",
        internalCallId: "internal_exec_1",
        toolCallId: "call_0",
        args: '{"cmd":"mkdir -p report"}',
        result: "",
        structuredResult: { stdout: "", stderr: "", exitCode: 0 },
      },
    ];

    for (const [index, event] of events.entries()) {
      messages = applyEvent(messages, event);
      if (index === 2) {
        expect(toolParts(messages)).toMatchObject([
          {
            id: "tool_1_call_0",
            toolName: "webSearch",
            toolCallId: "call_0",
            turn: 1,
            state: "output-available",
            input: { query: "AAPL stock price market analysis 2025" },
            output: { query: "AAPL stock price market analysis 2025", results: [] },
          },
        ]);
      }
    }

    expect(partSummary(messages)).toEqual([
      { type: "reasoning", text: "I need to search first." },
      {
        type: "tool",
        id: "tool_1_call_0",
        toolName: "webSearch",
        toolCallId: "call_0",
        callId: "call_0",
        turn: 1,
        state: "output-available",
        input: { query: "AAPL stock price market analysis 2025" },
        output: { query: "AAPL stock price market analysis 2025", results: [] },
      },
      { type: "reasoning", text: "Now I need to create a folder." },
      {
        type: "tool",
        id: "tool_2_call_0",
        toolName: "exec_command",
        toolCallId: "call_0",
        callId: "call_0",
        turn: 2,
        state: "output-available",
        input: { cmd: "mkdir -p report" },
        output: { stdout: "", stderr: "", exitCode: 0 },
      },
    ]);
  });

  it("uses same-turn input fallback for internal-only results with reused ids", () => {
    const messages = reduceEvents([
      { type: "reasoning_delta", turn: 1, delta: "I need to search first." },
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      },
      {
        type: "tool_result",
        turn: 1,
        toolName: "webSearch",
        internalCallId: "internal_search_1",
        args: '{"query":"AAPL stock price market analysis 2025"}',
        result: "search results...",
        structuredResult: {
          query: "AAPL stock price market analysis 2025",
          results: [],
        },
      },
      { type: "reasoning_delta", turn: 2, delta: "Now I need to create a folder." },
      {
        type: "tool_call",
        turn: 2,
        toolCall: AssistantContent.toolCall("0", "exec_command", {
          cmd: "mkdir -p report",
        }),
      },
      {
        type: "tool_result",
        turn: 2,
        toolName: "exec_command",
        internalCallId: "internal_exec_1",
        args: '{"cmd":"mkdir -p report"}',
        result: "",
        structuredResult: { stdout: "", stderr: "", exitCode: 0 },
      },
    ]);

    expect(toolParts(messages)).toMatchObject([
      {
        id: "tool_1_0",
        toolName: "webSearch",
        toolCallId: "0",
        turn: 1,
        state: "output-available",
        input: { query: "AAPL stock price market analysis 2025" },
        output: { query: "AAPL stock price market analysis 2025", results: [] },
      },
      {
        id: "tool_2_0",
        toolName: "exec_command",
        toolCallId: "0",
        turn: 2,
        state: "output-available",
        input: { cmd: "mkdir -p report" },
        output: { stdout: "", stderr: "", exitCode: 0 },
      },
    ]);
  });

  it("does not match same toolCallId across different incoming turns", () => {
    const messages = reduceEvents([
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("call_0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      },
      {
        type: "tool_call",
        turn: 2,
        toolCall: AssistantContent.toolCall("call_0", "exec_command", {
          cmd: "mkdir -p report",
        }),
      },
    ]);

    expect(toolParts(messages)).toMatchObject([
      { id: "tool_1_call_0", toolName: "webSearch", toolCallId: "call_0", turn: 1 },
      { id: "tool_2_call_0", toolName: "exec_command", toolCallId: "call_0", turn: 2 },
    ]);
  });

  it("does not match unturned incoming parts against turned existing parts", () => {
    const messages = reduceEvents([
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("call_0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      },
      {
        type: "tool_result",
        toolName: "webSearch",
        internalCallId: "internal_search_1",
        toolCallId: "call_0",
        args: '{"query":"AAPL stock price market analysis 2025"}',
        result: "search results...",
      },
    ]);

    expect(toolParts(messages)).toMatchObject([
      {
        id: "tool_1_call_0",
        toolName: "webSearch",
        toolCallId: "call_0",
        turn: 1,
        state: "input-available",
      },
      {
        id: "tool_call_0",
        toolName: "webSearch",
        toolCallId: "call_0",
        state: "output-available",
        output: "search results...",
      },
    ]);
    expect(turnOf(toolParts(messages)[1])).toBeUndefined();
  });

  it("keeps legacy no-turn matching among unturned parts", () => {
    const messages = reduceEvents([
      {
        type: "tool_call",
        toolCall: AssistantContent.toolCall("call_0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      },
      {
        type: "tool_result",
        toolName: "webSearch",
        internalCallId: "internal_search_1",
        toolCallId: "call_0",
        args: '{"query":"AAPL stock price market analysis 2025"}',
        result: "search results...",
      },
    ]);

    expect(toolParts(messages)).toMatchObject([
      {
        id: "tool_call_0",
        toolName: "webSearch",
        toolCallId: "call_0",
        state: "output-available",
        input: { query: "AAPL stock price market analysis 2025" },
        output: "search results...",
      },
    ]);
    expect(turnOf(toolParts(messages)[0])).toBeUndefined();
  });

  it("does not add turn metadata while replaying persisted core messages", () => {
    const messages = coreMessagesToUIMessages([
      Message.assistant([
        AssistantContent.toolCall("call_0", "webSearch", {
          query: "AAPL stock price market analysis 2025",
        }),
      ]),
      Message.toolResult("call_0", "search results...", { toolName: "webSearch" }),
    ]);

    expect(toolParts(messages)).toHaveLength(1);
    expect(turnOf(toolParts(messages)[0])).toBeUndefined();
  });
});

function applyEvent(messages: UIMessage[], event: unknown): UIMessage[] {
  return applyAnviaStreamEvent(messages, event) ?? messages;
}

function reduceEvents(events: unknown[]): UIMessage[] {
  return events.reduce<UIMessage[]>((messages, event) => applyEvent(messages, event), []);
}

function toolParts(messages: UIMessage[]): UIToolPart[] {
  return messages.flatMap((message) =>
    message.parts.filter((part): part is UIToolPart => part.type === "tool"),
  );
}

function partSummary(messages: UIMessage[]): unknown[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part): unknown[] => {
      if (part.type === "reasoning") {
        return [{ type: "reasoning", text: part.text }];
      }
      if (part.type === "tool") {
        return [
          {
            id: part.id,
            type: "tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            ...(part.callId === undefined ? {} : { callId: part.callId }),
            ...(turnOf(part) === undefined ? {} : { turn: turnOf(part) }),
            state: part.state,
            ...(part.input === undefined ? {} : { input: part.input }),
            ...(part.output === undefined ? {} : { output: part.output }),
          },
        ];
      }
      return [];
    }),
  );
}

function turnOf(part: UIToolPart | undefined): unknown {
  return part === undefined ? undefined : (part as Record<string, unknown>).turn;
}
