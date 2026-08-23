import type { AgentStreamEvent } from "@anvia/core/agent";
import {
  type CompletionStreamEvent,
  type Message as CoreMessage,
  Usage,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  agentToClientStream,
  applyClientStreamEvent,
  type ClientStreamEvent,
  type ClientStreamRequest,
  completionToClientStream,
  createDirectClientTransport,
  createHttpClientTransport,
  messagesToUIMessages,
  parseClientStreamEvent,
  parseClientStreamFrame,
  parseClientStreamRequest,
  parseUIMessage,
  type UIToolMessagePart,
  uiMessagesToMessages,
} from "../src";

function CompileClientBoundary() {
  const events = values<ClientStreamEvent>([]);
  // @ts-expect-error Stream adapters accept one options object.
  completionToClientStream(events);
  // @ts-expect-error Direct transports accept one options object.
  createDirectClientTransport(() => events);
  const transport = createDirectClientTransport({ handler: () => events });
  // @ts-expect-error Transport send accepts one options object, not a bare request.
  transport.send({ messages: [] });
}
void CompileClientBoundary;

function CompileToolPartBoundary() {
  const streaming: UIToolMessagePart = {
    id: "part_1",
    type: "tool",
    toolName: "search",
    toolCallId: "call_1",
    state: "input-streaming",
    input: '{"query":',
  };
  // @ts-expect-error Completed tool calls require their parsed input.
  const missingInput: UIToolMessagePart = {
    id: "part_2",
    type: "tool",
    toolName: "search",
    toolCallId: "call_2",
    state: "input-available",
  };
  // @ts-expect-error Successful tool results require an output.
  const missingOutput: UIToolMessagePart = {
    id: "part_3",
    type: "tool",
    toolName: "search",
    toolCallId: "call_3",
    state: "output-available",
    input: {},
  };
  // @ts-expect-error Failed tool results require a structured error.
  const missingError: UIToolMessagePart = {
    id: "part_4",
    type: "tool",
    toolName: "search",
    toolCallId: "call_4",
    state: "error",
    input: {},
  };
  return [streaming, missingInput, missingOutput, missingError];
}
void CompileToolPartBoundary;

describe("message boundary", () => {
  it("round-trips model IDs, metadata, reasoning, attachments, and tool results", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look", signature: "user_sig" },
          { type: "image", image: { type: "url", url: "https://example.com/image.png" } },
        ],
      },
      {
        role: "assistant",
        id: "provider_message_1",
        metadata: { custom: true },
        content: [
          { type: "reasoning", id: "reason_1", text: "Think" },
          {
            type: "tool-call",
            toolCallId: "tool_1",
            callId: "call_1",
            toolName: "weather",
            input: { city: "Jakarta" },
            signature: "tool_sig",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool_1",
            callId: "call_1",
            toolName: "weather",
            output: { type: "content", value: [{ type: "text", text: "Sunny" }] },
          },
        ],
      },
    ] satisfies CoreMessage[];

    const ui = messagesToUIMessages(messages);
    expect(ui[1]).toMatchObject({
      modelMessageId: "provider_message_1",
      metadata: { custom: true },
    });
    expect(ui[1]?.parts.find((part) => part.type === "tool")).toMatchObject({
      state: "output-available",
      output: "Sunny",
    });
    expect(uiMessagesToMessages(ui)).toEqual(messages);
  });

  it("refuses to replay partial streamed tool input", () => {
    expect(() =>
      uiMessagesToMessages([
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              id: "tool_1",
              type: "tool",
              toolName: "search",
              toolCallId: "call_1",
              state: "input-streaming",
              input: '{"query":',
            },
          ],
        },
      ]),
    ).toThrow("still streaming");
  });

  it("requires tool results to retain their matching tool-call input", () => {
    expect(() =>
      messagesToUIMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "search",
              output: { type: "text", value: "done" },
            },
          ],
        },
      ]),
    ).toThrow("matching completed tool call");
  });

  it("retains tool-call input when result metadata keeps the result in its own UI message", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "search",
            input: { query: "Anvia" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "search",
            output: { type: "text", value: "done" },
          },
        ],
        metadata: { source: "worker" },
      },
    ] satisfies CoreMessage[];

    const ui = messagesToUIMessages(messages);
    expect(ui[1]?.parts[0]).toMatchObject({
      state: "output-available",
      input: { query: "Anvia" },
      output: "done",
    });
    expect(uiMessagesToMessages(ui)).toEqual(messages);
  });
});

describe("native stream adapters", () => {
  it("preserves explicit memory compaction events and terminal metadata", async () => {
    const memoryCompaction = {
      originalMessageCount: 12,
      compactedMessageCount: 8,
      retainedMessageCount: 4,
      attempts: 1,
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
    const events = await collect(
      agentToClientStream({
        events: values<AgentStreamEvent>([
          { type: "memory_compaction", ...memoryCompaction },
          {
            type: "response",
            runId: "native_run",
            text: "done",
            output: "done",
            usage: Usage.empty(),
            messages: [],
            trace: {
              observer: "langfuse",
              traceId: "trace_1",
              observationId: "observation_1",
            },
            memoryCompaction,
          },
        ]),
        runId: "client_run",
      }),
    );

    expect(events.find((event) => event.type === "memory_compaction")).toEqual({
      type: "memory_compaction",
      runId: "client_run",
      ...memoryCompaction,
    });
    expect(events.find((event) => event.type === "run_end")).toMatchObject({
      status: "completed",
      trace: {
        observer: "langfuse",
        traceId: "trace_1",
        observationId: "observation_1",
      },
      memoryCompaction,
    });
    expect(
      events.reduce<ReturnType<typeof applyClientStreamEvent>>(
        (messages, event) => applyClientStreamEvent(messages, event),
        [],
      ),
    ).toEqual([]);
  });

  it("always exposes tool-call deltas without an include option", async () => {
    const stream = completionToClientStream({
      events: values<CompletionStreamEvent>([
        {
          type: "tool_call_delta",
          id: "tool_1",
          name: "weather",
          argumentsDelta: '{"city":',
        },
        {
          type: "tool_call_delta",
          id: "tool_1",
          argumentsDelta: '"Jakarta"}',
        },
        {
          type: "tool_call",
          toolCall: {
            type: "tool-call",
            toolCallId: "tool_1",
            toolName: "weather",
            input: { city: "Jakarta" },
          },
        },
        {
          type: "final",
          result: {
            output: "",
            text: "",
            content: [
              {
                type: "tool-call",
                toolCallId: "tool_1",
                toolName: "weather",
                input: { city: "Jakarta" },
              },
            ],
            usage: Usage.empty(),
            rawResponse: { secret: true },
          },
        },
      ]),
      runId: "client_run",
    });
    const events = await collect(stream);
    expect(events.filter((event) => event.type === "tool_call_delta")).toHaveLength(2);
    const completedCalls = events.filter((event) => event.type === "tool_call_end");
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0]).toMatchObject({
      input: { city: "Jakarta" },
    });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("keeps agent prompt, history, requests, and raw responses behind the adapter", async () => {
    const native = values<AgentStreamEvent>([
      {
        type: "turn_start",
        turn: 1,
        prompt: { role: "user", content: "private prompt" },
        history: [{ role: "user", content: "private history" }],
      },
      {
        type: "generation_start",
        turn: 1,
        request: {
          chatHistory: [{ role: "user", content: "private request" }],
          documents: [],
          tools: [],
        },
        modelInfo: { provider: "test", modelId: "model" },
      },
      { type: "text_delta", turn: 1, delta: "Safe" },
      {
        type: "turn_end",
        turn: 1,
        response: {
          choice: [{ type: "text", text: "Safe" }],
          usage: Usage.empty(),
          rawResponse: { private: true },
        },
      },
      {
        type: "response",
        runId: "native_run",
        text: "Safe",
        output: "Safe",
        usage: Usage.empty(),
        messages: [],
      },
    ]);
    const events = await collect(
      agentToClientStream({
        events: native,
        runId: "client_run",
        metadata: { tenantId: "acme" },
      }),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private history");
    expect(serialized).not.toContain("private request");
    expect(serialized).not.toContain('"private":true');
    expect(events.find((event) => event.type === "run_end")).toMatchObject({
      runId: "client_run",
      metadata: { tenantId: "acme" },
    });
  });

  it("keeps typed adapter metadata valid through terminal events", async () => {
    const transport = createDirectClientTransport({
      handler: () =>
        agentToClientStream({
          metadata: { tenantId: "acme" },
          events: values<AgentStreamEvent>([
            {
              type: "response",
              runId: "native_run",
              text: "done",
              output: "done",
              usage: Usage.empty(),
              messages: [],
            },
          ]),
        }),
      metadataSchema: {
        safeParse(value: unknown) {
          return typeof value === "object" &&
            value !== null &&
            "tenantId" in value &&
            value.tenantId === "acme"
            ? { success: true as const, data: { tenantId: "acme" } }
            : { success: false as const };
        },
      },
    });

    const frames = await collect(transport.send({ request: { type: "messages", messages: [] } }));
    expect(frames.at(-1)).toMatchObject({ type: "stream_end", status: "completed" });
    expect(
      frames.find((frame) => frame.type === "stream_event" && frame.event.type === "run_end"),
    ).toMatchObject({ event: { metadata: { tenantId: "acme" } } });
  });

  it("masks native errors by default", async () => {
    const events = await collect(
      completionToClientStream({
        events: values<CompletionStreamEvent>([
          { type: "error", error: new Error("database password"), usage: Usage.empty() },
        ]),
      }),
    );
    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: { message: "An unexpected error occurred." },
    });
    expect(JSON.stringify(events)).not.toContain("database password");
  });

  it("honors output mappers that suppress output or map it to null", async () => {
    const completion = (): CompletionStreamEvent<{ secret: boolean }>[] => [
      {
        type: "final",
        result: {
          output: { secret: true },
          text: "Safe",
          content: [{ type: "text", text: "Safe" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ];

    const suppressed = await collect(
      completionToClientStream({ events: values(completion()), mapOutput: () => undefined }),
    );
    expect(suppressed.find((event) => event.type === "run_end")).not.toHaveProperty("output");
    expect(JSON.stringify(suppressed)).not.toContain("secret");

    const nulled = await collect(
      completionToClientStream({ events: values(completion()), mapOutput: () => null }),
    );
    expect(nulled.find((event) => event.type === "run_end")).toMatchObject({ output: null });
  });

  it("emits final-only sources and provider tool calls without duplicating streamed values", async () => {
    const sharedSource = { type: "url" as const, url: "https://example.com/a", id: "source_a" };
    const sharedToolCall = { id: "provider_a", name: "search", status: "completed" };
    const events = await collect(
      completionToClientStream({
        events: values<CompletionStreamEvent>([
          { type: "source", source: sharedSource },
          { type: "provider_tool_call", toolCall: sharedToolCall },
          {
            type: "final",
            result: {
              output: "done",
              text: "done",
              content: [{ type: "text", text: "done" }],
              usage: Usage.empty(),
              rawResponse: {},
              sources: [
                sharedSource,
                { type: "url", url: "https://example.com/b", id: "source_b" },
              ],
              providerToolCalls: [
                sharedToolCall,
                { id: "provider_b", name: "search", status: "completed" },
              ],
            },
          },
        ]),
      }),
    );

    expect(events.filter((event) => event.type === "source")).toHaveLength(2);
    expect(events.filter((event) => event.type === "provider_tool_call")).toHaveLength(2);
  });

  it("finalizes anonymous reasoning without restarting or clearing it", async () => {
    const events = await collect(
      completionToClientStream({
        events: values<CompletionStreamEvent>([
          { type: "reasoning_delta", delta: "Think", contentType: "summary" },
          {
            type: "final",
            result: {
              output: "answer",
              text: "answer",
              content: [
                {
                  type: "reasoning",
                  text: "Thinking",
                  details: [{ type: "summary", text: "Thinking" }],
                },
                { type: "text", text: "answer" },
              ],
              usage: Usage.empty(),
              rawResponse: {},
            },
          },
        ]),
      }),
    );
    expect(events.filter((event) => event.type === "reasoning_start")).toHaveLength(1);

    const messages = events.reduce<ReturnType<typeof applyClientStreamEvent>>(
      (current, event) => applyClientStreamEvent(current, event),
      [],
    );
    expect(messages[0]?.parts.find((part) => part.type === "reasoning")).toMatchObject({
      text: "Thinking",
      content: [{ type: "summary", text: "Thinking" }],
    });
  });

  it("keeps identified and anonymous reasoning parts distinct at finalization", async () => {
    const events = await collect(
      completionToClientStream({
        events: values<CompletionStreamEvent>([
          { type: "reasoning_delta", delta: "anonymous" },
          { type: "reasoning_delta", id: "reason_1", delta: "identified" },
          {
            type: "final",
            result: {
              output: "answer",
              text: "answer",
              content: [
                { type: "reasoning", id: "reason_1", text: "identified" },
                { type: "reasoning", text: "anonymous" },
                { type: "text", text: "answer" },
              ],
              usage: Usage.empty(),
              rawResponse: {},
            },
          },
        ]),
      }),
    );
    const final = events.find((event) => event.type === "message_end");
    const reasoning = final?.parts?.filter((part) => part.type === "reasoning") ?? [];
    expect(reasoning.map((part) => part.text)).toEqual(["identified", "anonymous"]);
    expect(new Set(reasoning.map((part) => part.id)).size).toBe(2);
  });

  it("keeps tool results on the provider tool part using its explicit ID", async () => {
    const events = await collect(
      agentToClientStream({
        events: values<AgentStreamEvent>([
          {
            type: "tool_call",
            turn: 1,
            toolCall: {
              type: "tool-call",
              toolCallId: "provider_tool_1",
              toolName: "weather",
              input: { city: "Jakarta" },
            },
          },
          {
            type: "turn_end",
            turn: 1,
            response: {
              choice: [
                {
                  type: "tool-call",
                  toolCallId: "provider_tool_1",
                  toolName: "weather",
                  input: { city: "Jakarta" },
                },
              ],
              usage: Usage.empty(),
              rawResponse: {},
            },
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "weather",
            toolCallId: "provider_tool_1",
            internalCallId: "internal_tool_1",
            args: '{"city":"Jakarta"}',
            output: { type: "text", value: "Sunny" },
            result: "Sunny",
          },
          {
            type: "response",
            runId: "native_run",
            output: "Sunny",
            text: "Sunny",
            usage: Usage.empty(),
            messages: [],
          },
        ]),
        runId: "client_run",
      }),
    );
    const call = events.find((event) => event.type === "tool_call_end");
    const result = events.find((event) => event.type === "tool_result");
    expect(result).toMatchObject({
      partId: call?.partId,
      toolCallId: "provider_tool_1",
      internalCallId: "internal_tool_1",
      result: { status: "success", output: "Sunny" },
    });
  });

  it("associates concurrent same-name tool results by provider tool ID", async () => {
    const first = {
      type: "tool-call" as const,
      toolCallId: "provider_tool_a",
      toolName: "weather",
      input: { city: "Jakarta" },
    };
    const second = {
      type: "tool-call" as const,
      toolCallId: "provider_tool_b",
      toolName: "weather",
      input: { city: "Bandung" },
    };
    const events = await collect(
      agentToClientStream({
        events: values<AgentStreamEvent>([
          { type: "tool_call", turn: 1, toolCall: first },
          { type: "tool_call", turn: 1, toolCall: second },
          {
            type: "turn_end",
            turn: 1,
            response: { choice: [first, second], usage: Usage.empty(), rawResponse: {} },
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "weather",
            toolCallId: "provider_tool_b",
            internalCallId: "internal_b",
            args: '{"city":"Bandung"}',
            output: { type: "text", value: "Cloudy" },
            result: "Cloudy",
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "weather",
            toolCallId: "provider_tool_a",
            internalCallId: "internal_a",
            args: '{"city":"Jakarta"}',
            output: { type: "text", value: "Sunny" },
            result: "Sunny",
          },
          {
            type: "response",
            runId: "native_run",
            output: "done",
            text: "done",
            usage: Usage.empty(),
            messages: [],
          },
        ]),
      }),
    );
    const calls = events.filter((event) => event.type === "tool_call_end");
    const results = events.filter((event) => event.type === "tool_result");
    expect(results.find((event) => event.toolCallId === "provider_tool_b")?.partId).toBe(
      calls.find((event) => event.toolCallId === "provider_tool_b")?.partId,
    );
    expect(results.find((event) => event.toolCallId === "provider_tool_a")?.partId).toBe(
      calls.find((event) => event.toolCallId === "provider_tool_a")?.partId,
    );
  });

  it("preserves text output types and exposes failed tools as errors", async () => {
    const textCall = {
      type: "tool-call" as const,
      toolCallId: "text_tool",
      toolName: "text_tool",
      input: {},
    };
    const errorCall = {
      type: "tool-call" as const,
      toolCallId: "error_tool",
      toolName: "error_tool",
      input: {},
    };
    const events = await collect(
      agentToClientStream({
        events: values<AgentStreamEvent>([
          { type: "tool_call", turn: 1, toolCall: textCall },
          { type: "tool_call", turn: 1, toolCall: errorCall },
          {
            type: "turn_end",
            turn: 1,
            response: {
              choice: [textCall, errorCall],
              usage: Usage.empty(),
              rawResponse: {},
            },
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "text_tool",
            toolCallId: "text_tool",
            internalCallId: "internal_text",
            args: "{}",
            output: { type: "text", value: '{"looks":"json"}' },
            result: '{"looks":"json"}',
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "error_tool",
            toolCallId: "error_tool",
            internalCallId: "internal_error",
            args: "{}",
            output: { type: "error-json", value: { code: "FAILED" } },
            result: '{"code":"FAILED"}',
          },
          {
            type: "response",
            runId: "native_run",
            output: "done",
            text: "done",
            usage: Usage.empty(),
            messages: [],
          },
        ]),
      }),
    );
    const results = events.filter((event) => event.type === "tool_result");

    expect(results.find((event) => event.toolCallId === "text_tool")?.result).toEqual({
      status: "success",
      output: '{"looks":"json"}',
    });
    expect(results.find((event) => event.toolCallId === "error_tool")?.result).toEqual({
      status: "error",
      error: {
        message: "Tool execution failed.",
        code: "tool_execution_error",
        details: { code: "FAILED" },
      },
    });
  });

  it("maps suspended Agent finals to one interaction followed by a suspended run end", async () => {
    const interaction = {
      type: "tool-approval" as const,
      id: "interaction_1",
      toolName: "delete_account",
      toolCallId: "call_1",
      internalCallId: "internal_1",
      input: { accountId: "account_1" },
    };
    const events = await collect(
      agentToClientStream({
        runId: "run_1",
        events: values<AgentStreamEvent>([
          {
            type: "interaction",
            runId: "run_1",
            text: "",
            usage: Usage.empty(),
            messages: [],
            interaction,
            continuation: {
              version: 1,
              agentId: "agent_1",
              sourceRunId: "run_1",
              interaction,
              state: {},
            },
          },
        ]),
      }),
    );

    expect(events.map((event) => event.type)).toEqual(["run_start", "interaction", "run_end"]);
    expect(events[1]).toMatchObject({ type: "interaction", runId: "run_1", interaction });
    expect(events[2]).toMatchObject({ type: "run_end", runId: "run_1", status: "suspended" });
    expect(JSON.stringify(events)).not.toContain("continuation");
  });

  it("does not expose rejected child-Agent suspension as a resumable root interaction", async () => {
    const interaction = {
      type: "tool-approval" as const,
      id: "child_interaction",
      toolName: "delete_account",
      toolCallId: "call_1",
      internalCallId: "internal_1",
      input: {},
    };
    const events = await collect(
      agentToClientStream({
        runId: "root_run",
        events: values<AgentStreamEvent>([
          {
            type: "agent_tool_event",
            turn: 1,
            toolName: "child_agent",
            toolCallId: "parent_call",
            internalCallId: "parent_internal",
            agentId: "child",
            event: {
              type: "interaction",
              runId: "child_run",
              text: "",
              usage: Usage.empty(),
              messages: [],
              interaction,
              continuation: {
                version: 1,
                agentId: "child",
                sourceRunId: "child_run",
                interaction,
                state: {},
              },
            },
          },
        ]),
      }),
    );

    expect(events.some((event) => event.type === "interaction")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run_end",
        status: "suspended",
        scope: expect.objectContaining({ parentToolCallId: "parent_call" }),
      }),
    );
  });
});

describe("protocol and transport", () => {
  it("rejects direct-handler failures before emitting stream acceptance", async () => {
    const transport = createDirectClientTransport({
      handler: async () => {
        throw new Error("Interaction continuation is unavailable");
      },
    });

    await expect(
      collect(
        transport.send({
          request: { type: "messages", messages: [] },
        }),
      ),
    ).rejects.toThrow("Interaction continuation is unavailable");
  });

  it("rejects v1/v2 frames and legacy UI-message requests", () => {
    expect(() =>
      parseClientStreamFrame({
        type: "stream_start",
        protocol: "anvia.client.v1",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      }),
    ).toThrow("protocol v1 is not supported");
    expect(() =>
      parseClientStreamFrame({
        type: "stream_start",
        protocol: "anvia.client.v2",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      }),
    ).toThrow("protocol v2 is not supported");
    expect(() =>
      parseClientStreamRequest({
        messages: [
          {
            id: "message_1",
            role: "user",
            parts: [{ id: "part_1", type: "text", text: "legacy" }],
          },
        ],
      }),
    ).toThrow("request.type");
  });

  it("parses the discriminated interaction response request", () => {
    expect(
      parseClientStreamRequest({
        type: "interaction_response",
        interactionId: "interaction_1",
        response: { type: "tool-approval", approved: true },
        metadata: { tenantId: "acme" },
      }),
    ).toEqual({
      type: "interaction_response",
      interactionId: "interaction_1",
      response: { type: "tool-approval", approved: true },
      metadata: { tenantId: "acme" },
    });
    expect(() =>
      parseClientStreamRequest({
        type: "interaction_response",
        interactionId: "interaction_1",
        response: { type: "tool-approval", approved: true },
        messages: [],
      }),
    ).toThrow(/cannot include messages/);
  });

  it("validates memory compaction as a canonical client event", () => {
    expect(
      parseClientStreamEvent({
        type: "memory_compaction",
        runId: "run_1",
        originalMessageCount: 12,
        compactedMessageCount: 8,
        retainedMessageCount: 4,
        attempts: 1,
        usage: Usage.empty(),
      }),
    ).toMatchObject({ type: "memory_compaction", compactedMessageCount: 8 });
    expect(() =>
      parseClientStreamEvent({
        type: "memory_compaction",
        runId: "run_1",
        originalMessageCount: 12,
        compactedMessageCount: 8,
        retainedMessageCount: 4,
        attempts: 0,
        usage: Usage.empty(),
      }),
    ).toThrow("memory_compaction.attempts");
  });

  it("validates named data events with the provided runtime schema", () => {
    const schema = {
      safeParse(value: unknown) {
        return value === "ok"
          ? ({ success: true, data: "transformed" } as const)
          : ({ success: false } as const);
      },
    };
    expect(
      parseClientStreamEvent(
        { type: "data", runId: "run_1", name: "notice", data: "ok" },
        { dataSchemas: { notice: schema } },
      ),
    ).toMatchObject({ name: "notice", data: "transformed" });
    expect(() =>
      parseClientStreamEvent(
        { type: "data", runId: "run_1", name: "notice", data: "bad" },
        { dataSchemas: { notice: schema } },
      ),
    ).toThrow('Invalid data event "notice"');
  });

  it("returns transformed data from framed HTTP transports", async () => {
    const transport = createHttpClientTransport<ClientStreamRequest, { count: number }>({
      endpoint: "/api/chat",
      dataSchemas: {
        count: {
          safeParse(value: unknown) {
            return typeof value === "string" && /^\d+$/.test(value)
              ? ({ success: true, data: Number(value) } as const)
              : ({ success: false } as const);
          },
        },
      },
      fetch: async () =>
        new Response(
          [
            {
              type: "stream_start",
              protocol: "anvia.client.v3",
              streamId: "stream_1",
              eventId: 0,
              resumable: false,
            },
            {
              type: "stream_event",
              streamId: "stream_1",
              eventId: 1,
              event: { type: "data", runId: "run_1", name: "count", data: "42" },
            },
            { type: "stream_end", streamId: "stream_1", eventId: 1, status: "completed" },
          ]
            .map((frame) => JSON.stringify(frame))
            .join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
              "x-anvia-stream-protocol": "anvia.client.v3",
            },
          },
        ),
    });

    const frames = await collect(transport.send({ request: { type: "messages", messages: [] } }));
    expect(frames.find((frame) => frame.type === "stream_event")?.event).toMatchObject({
      name: "count",
      data: 42,
    });
  });

  it("rejects undeclared protocol fields instead of forwarding raw payloads", () => {
    expect(() =>
      parseClientStreamEvent({
        type: "run_end",
        runId: "run_1",
        status: "completed",
        rawResponse: { secret: true },
      }),
    ).toThrow('run_end event has unknown field "rawResponse"');
  });

  it("preserves explicit observer provenance and rejects ambiguous traces", () => {
    expect(
      parseClientStreamEvent({
        type: "run_end",
        runId: "run_1",
        status: "completed",
        trace: {
          observer: "langfuse",
          traceId: "trace_1",
          observationId: "observation_1",
        },
      }),
    ).toMatchObject({
      trace: {
        observer: "langfuse",
        traceId: "trace_1",
        observationId: "observation_1",
      },
    });
    expect(() =>
      parseClientStreamEvent({
        type: "run_end",
        runId: "run_1",
        status: "completed",
        trace: { traceId: "trace_1" },
      }),
    ).toThrow("run_end.trace");
  });

  it("frames direct streams even though no HTTP boundary is involved", async () => {
    const transport = createDirectClientTransport({
      handler: ({ request: _request }: { request: ClientStreamRequest }) =>
        values<ClientStreamEvent>([
          { type: "run_start", runId: "run_1", source: "completion" },
          { type: "run_end", runId: "run_1", status: "completed" },
        ]),
    });
    const frames = await collect(transport.send({ request: { type: "messages", messages: [] } }));
    expect(frames.map((frame) => frame.type)).toEqual([
      "stream_start",
      "stream_event",
      "stream_event",
      "stream_end",
    ]);
    expect(frames[0]).toMatchObject({ protocol: "anvia.client.v3", resumable: false });
  });

  it("propagates direct transport cancellation into the handled stream", async () => {
    let finishNext: ((result: IteratorResult<ClientStreamEvent>) => void) | undefined;
    let closed = false;
    const transport = createDirectClientTransport({
      handler: ({ abortSignal }) => ({
        [Symbol.asyncIterator]() {
          expect(abortSignal).toBeDefined();
          return {
            next: () =>
              new Promise<IteratorResult<ClientStreamEvent>>((resolve) => {
                finishNext = resolve;
              }),
            return: async () => {
              closed = true;
              finishNext?.({ done: true, value: undefined });
              return { done: true, value: undefined };
            },
          };
        },
      }),
    });
    const controller = new AbortController();
    const iterator = transport
      .send({ request: { type: "messages", messages: [] }, abortSignal: controller.signal })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "stream_start" },
    });
    const pending = iterator.next();
    controller.abort();
    await expect(pending).resolves.toMatchObject({ value: { type: "stream_end" } });
    expect(closed).toBe(true);
  });

  it("rejects a second stream_start frame", async () => {
    const frames = [
      {
        type: "stream_start",
        protocol: "anvia.client.v3",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      },
      {
        type: "stream_start",
        protocol: "anvia.client.v3",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      },
    ];
    const transport = createHttpClientTransport({
      endpoint: "/api/chat",
      fetch: async () =>
        new Response(frames.map((frame) => JSON.stringify(frame)).join("\n"), {
          headers: {
            "content-type": "application/x-ndjson",
            "x-anvia-stream-protocol": "anvia.client.v3",
          },
        }),
    });

    await expect(
      collect(transport.send({ request: { type: "messages", messages: [] } })),
    ).rejects.toThrow("more than one stream_start");
  });

  it("rejects resume responses for another or non-resumable stream", async () => {
    function transportFor(streamId: string, resumable: boolean) {
      return createHttpClientTransport({
        endpoint: "/api/chat",
        fetch: async () =>
          new Response(
            [
              {
                type: "stream_start",
                protocol: "anvia.client.v3",
                streamId,
                eventId: 0,
                resumable,
              },
              { type: "stream_end", streamId, eventId: 2, status: "completed" },
            ]
              .map((frame) => JSON.stringify(frame))
              .join("\n"),
            {
              headers: {
                "content-type": "application/x-ndjson",
                "x-anvia-stream-protocol": "anvia.client.v3",
              },
            },
          ),
      });
    }
    const request: ClientStreamRequest = {
      type: "messages",
      messages: [],
      resume: { streamId: "expected", after: 2 },
    };

    await expect(collect(transportFor("wrong", true).send({ request }))).rejects.toThrow(
      "streamId does not match",
    );
    await expect(collect(transportFor("expected", false).send({ request }))).rejects.toThrow(
      "must identify a resumable stream",
    );
  });

  it("keeps JSON object metadata lossless and stores generated state separately", () => {
    const afterMessage = applyClientStreamEvent(
      [{ id: "assistant_1", role: "assistant", parts: [], metadata: { source: "user" } }],
      {
        type: "message_end",
        runId: "run_1",
        messageId: "assistant_1",
        usage: Usage.empty(),
      },
    );
    const afterRun = applyClientStreamEvent(afterMessage, {
      type: "run_end",
      runId: "run_1",
      status: "completed",
    });

    expect(afterRun[0]?.metadata).toEqual({ source: "user" });
    expect(afterRun[0]?.generation).toMatchObject({ runId: "run_1", status: "completed" });
  });

  it("rejects primitive UI metadata", () => {
    expect(() =>
      parseUIMessage({ id: "message_1", role: "user", parts: [], metadata: "invalid" }),
    ).toThrow("metadata");
  });

  it("rejects UI messages with values that are not strict JSON", () => {
    expect(() =>
      parseUIMessage({
        id: "message_1",
        role: "assistant",
        parts: [{ id: "text_1", type: "text", text: "hello", signature: undefined }],
      }),
    ).toThrow("strict JSON");
  });

  it("rejects impossible UI tool-part state combinations", () => {
    const message = (part: Record<string, unknown>) => ({
      id: "message_1",
      role: "assistant",
      parts: [
        {
          id: "tool_1",
          type: "tool",
          toolName: "search",
          toolCallId: "call_1",
          ...part,
        },
      ],
    });

    expect(() => parseUIMessage(message({ state: "input-streaming", input: {} }))).toThrow(
      "invalid part",
    );
    expect(() => parseUIMessage(message({ state: "input-available" }))).toThrow("invalid part");
    expect(() =>
      parseUIMessage(message({ state: "input-available", input: {}, output: "unexpected" })),
    ).toThrow("invalid part");
    expect(() => parseUIMessage(message({ state: "output-available", input: {} }))).toThrow(
      "invalid part",
    );
    expect(() =>
      parseUIMessage(
        message({ state: "output-available", input: {}, output: "done", error: { message: "x" } }),
      ),
    ).toThrow("invalid part");
    expect(() => parseUIMessage(message({ state: "error", input: {} }))).toThrow("invalid part");
    expect(() =>
      parseUIMessage(
        message({ state: "error", input: {}, output: null, error: { message: "failed" } }),
      ),
    ).toThrow("invalid part");
  });

  it("requires tool-result stream events to carry the original input", () => {
    expect(() =>
      parseClientStreamEvent({
        type: "tool_result",
        runId: "run_1",
        messageId: "message_1",
        partId: "tool_1",
        toolCallId: "call_1",
        toolName: "search",
        result: { status: "success", output: "done" },
      }),
    ).toThrow("tool_result.input");
  });

  it("validates and transforms authoritative message data parts", () => {
    type Data = { progress: { completed: number; total: number } };
    const dataSchemas = {
      progress: {
        safeParse(value: unknown) {
          if (
            typeof value !== "object" ||
            value === null ||
            !("completed" in value) ||
            !("total" in value) ||
            typeof value.completed !== "number" ||
            typeof value.total !== "number"
          ) {
            return { success: false as const };
          }
          return {
            success: true as const,
            data: { completed: Math.trunc(value.completed), total: Math.trunc(value.total) },
          };
        },
      },
    };
    const event = parseClientStreamEvent<Record<string, never>, Data>(
      {
        type: "message_end",
        runId: "run_1",
        messageId: "assistant_1",
        parts: [
          {
            id: "progress_1",
            type: "data",
            name: "progress",
            data: { completed: 1.9, total: 3.2 },
          },
        ],
      },
      { dataSchemas },
    );

    expect(event).toMatchObject({
      parts: [
        {
          name: "progress",
          data: { completed: 1, total: 3 },
        },
      ],
    });
    expect(() =>
      parseClientStreamEvent<Record<string, never>, Data>(
        {
          type: "message_end",
          runId: "run_1",
          messageId: "assistant_1",
          parts: [{ id: "unknown_1", type: "data", name: "unknown", data: {} }],
        },
        { dataSchemas },
      ),
    ).toThrow('Invalid data event "unknown"');
  });

  it("uses message_end parts as the authoritative guarded result", () => {
    const event: ClientStreamEvent = {
      type: "message_end",
      runId: "run_1",
      messageId: "assistant_1",
      parts: [{ id: "text_1", type: "text", text: "corrected" }],
    };
    const next = applyClientStreamEvent(
      [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [{ id: "text_1", type: "text", text: "unsafe draft" }],
        },
      ],
      event,
    );
    expect(next[0]?.parts[0]).toMatchObject({ text: "corrected" });
  });
});

function values<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}
