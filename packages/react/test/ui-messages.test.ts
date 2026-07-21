import { AssistantContent, Message } from "@anvia/core/completion";
import { coreMessagesToUIMessages, type UIMessage, type UIMessagePart } from "@anvia/core/ui";
import { describe, expect, it } from "vitest";

import { applyAnviaStreamEvent } from "../src/ui-messages";

type UIToolPart = Extract<UIMessagePart, { type: "tool" }>;

describe("@anvia/react UI message reducer", () => {
  it("merges interleaved reasoning deltas with the same id at their first position", () => {
    const messages = reduceEvents([
      {
        type: "reasoning_delta",
        id: "stable-r",
        delta: "Let me provide a straightfo",
      },
      { type: "text_delta", delta: "Hello, Indra Z" },
      {
        type: "reasoning_delta",
        id: "stable-r",
        delta: "rward introduction.",
      },
      { type: "text_delta", delta: "ulfi! I'm DeepSeek V4 Pro" },
    ]);

    expect(partSummary(messages)).toEqual([
      {
        type: "reasoning",
        text: "Let me provide a straightforward introduction.",
      },
      { type: "text", text: "Hello, Indra Zulfi! I'm DeepSeek V4 Pro" },
    ]);
  });

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

  it("does not guess when same-turn input fallback is ambiguous", () => {
    const messages = reduceEvents([
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("tool_a", "lookup", { query: "Anvia" }),
      },
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall("tool_b", "lookup", { query: "Anvia" }),
      },
      {
        type: "tool_result",
        turn: 1,
        toolName: "lookup",
        internalCallId: "internal_result",
        args: '{"query":"Anvia"}',
        result: "result",
      },
    ]);

    expect(toolParts(messages)).toMatchObject([
      { toolCallId: "tool_a", state: "input-available", input: { query: "Anvia" } },
      { toolCallId: "tool_b", state: "input-available", input: { query: "Anvia" } },
      { toolCallId: "internal_result", state: "output-available", output: "result" },
    ]);
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

  it("matches live and persisted ordering when provider tool ids repeat across turns", () => {
    const live = reduceEvents([
      { type: "text_delta", turn: 1, delta: "Searching first." },
      {
        type: "tool_call",
        turn: 1,
        toolCall: AssistantContent.toolCall(
          "tool_0",
          "webSearch",
          { query: "Anvia" },
          "call_search",
        ),
      },
      {
        type: "tool_result",
        turn: 1,
        toolName: "webSearch",
        toolCallId: "call_search",
        internalCallId: "internal_search",
        args: '{"query":"Anvia"}',
        result: "search-result",
      },
      { type: "text_delta", turn: 2, delta: "Writing next." },
      {
        type: "tool_call",
        turn: 2,
        toolCall: AssistantContent.toolCall(
          "tool_0",
          "write_file",
          { path: "report.md" },
          "call_write",
        ),
      },
      {
        type: "tool_result",
        turn: 2,
        toolName: "write_file",
        toolCallId: "call_write",
        internalCallId: "internal_write",
        args: '{"path":"report.md"}',
        result: "written",
      },
      { type: "text_delta", turn: 2, delta: "Done." },
    ]);
    const persisted = coreMessagesToUIMessages([
      Message.assistant([
        AssistantContent.text("Searching first."),
        AssistantContent.toolCall("tool_0", "webSearch", { query: "Anvia" }, "call_search"),
      ]),
      Message.toolResult("tool_0", "search-result", {
        callId: "call_search",
        toolName: "webSearch",
      }),
      Message.assistant([
        AssistantContent.text("Writing next."),
        AssistantContent.toolCall("tool_0", "write_file", { path: "report.md" }, "call_write"),
      ]),
      Message.toolResult("tool_0", "written", {
        callId: "call_write",
        toolName: "write_file",
      }),
      Message.assistant("Done."),
    ]);

    expect(semanticPartSummary(live)).toEqual(semanticPartSummary(persisted));
    expect(partSummary(live)).toEqual([
      { type: "text", text: "Searching first." },
      {
        type: "tool",
        id: "tool_1_tool_0",
        toolName: "webSearch",
        toolCallId: "tool_0",
        callId: "call_search",
        turn: 1,
        state: "output-available",
        input: { query: "Anvia" },
        output: "search-result",
      },
      { type: "text", text: "Writing next." },
      {
        type: "tool",
        id: "tool_2_tool_0",
        toolName: "write_file",
        toolCallId: "tool_0",
        callId: "call_write",
        turn: 2,
        state: "output-available",
        input: { path: "report.md" },
        output: "written",
      },
      { type: "text", text: "Done." },
    ]);
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
      if (part.type === "text") {
        return [{ type: "text", text: part.text }];
      }
      if (part.type === "reasoning") {
        return [{ type: "reasoning", text: part.text }];
      }
      if (part.type === "tool") {
        const summary: Record<string, unknown> = {
          id: part.id,
          type: "tool",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          state: part.state,
        };
        if (part.callId !== undefined) summary.callId = part.callId;
        const turn = turnOf(part);
        if (turn !== undefined) summary.turn = turn;
        if (part.input !== undefined) summary.input = part.input;
        if (part.output !== undefined) summary.output = part.output;
        return [summary];
      }
      return [];
    }),
  );
}

function semanticPartSummary(messages: UIMessage[]): unknown[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part): unknown[] => {
      if (part.type === "text") {
        return [{ type: "text", text: part.text }];
      }
      if (part.type !== "tool") {
        return [];
      }
      const summary: Record<string, unknown> = {
        type: "tool",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        state: part.state,
      };
      if (part.callId !== undefined) summary.callId = part.callId;
      if (part.input !== undefined) summary.input = part.input;
      if (part.output !== undefined) summary.output = part.output;
      return [summary];
    }),
  );
}

function turnOf(part: UIToolPart | undefined): unknown {
  return part === undefined ? undefined : (part as Record<string, unknown>).turn;
}
