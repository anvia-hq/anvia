import type { AgentStreamEvent } from "@anvia/core/agent";
import {
  type CompletionStreamEvent,
  type Message as CoreMessage,
  Message,
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
  uiMessagesToMessages,
} from "../src";

describe("message boundary", () => {
  it("round-trips model IDs, metadata, reasoning, attachments, and tool results", () => {
    const messages: CoreMessage[] = [
      Message.user([
        { type: "text", text: "Look", signature: "user_sig" },
        { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
      ]),
      Message.assistant(
        [
          { type: "reasoning", id: "reason_1", text: "Think" },
          {
            type: "tool_call",
            id: "tool_1",
            callId: "call_1",
            function: { name: "weather", arguments: { city: "Jakarta" } },
            signature: "tool_sig",
            additionalParams: { provider: "value" },
          },
        ],
        { id: "provider_message_1", metadata: { custom: true } },
      ),
      Message.toolResult("tool_1", [{ type: "text", text: "Sunny" }], {
        callId: "call_1",
        toolName: "weather",
      }),
    ];

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
      agentToClientStream(
        values<AgentStreamEvent>([
          { type: "memory_compaction", ...memoryCompaction },
          {
            type: "final",
            result: {
              status: "completed",
              runId: "native_run",
              text: "done",
              output: "done",
              usage: Usage.empty(),
              messages: [],
              memoryCompaction,
            },
          },
        ]),
        { runId: "client_run" },
      ),
    );

    expect(events.find((event) => event.type === "memory_compaction")).toEqual({
      type: "memory_compaction",
      runId: "client_run",
      ...memoryCompaction,
    });
    expect(events.find((event) => event.type === "run_end")).toMatchObject({
      status: "completed",
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
    const stream = completionToClientStream(
      values<CompletionStreamEvent>([
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
            type: "tool_call",
            id: "tool_1",
            function: { name: "weather", arguments: { city: "Jakarta" } },
          },
        },
        {
          type: "final",
          result: {
            output: "",
            text: "",
            content: [
              {
                type: "tool_call",
                id: "tool_1",
                function: { name: "weather", arguments: { city: "Jakarta" } },
              },
            ],
            usage: Usage.empty(),
            rawResponse: { secret: true },
          },
        },
      ]),
      { runId: "client_run" },
    );
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
        prompt: Message.user("private prompt"),
        history: [Message.user("private history")],
      },
      {
        type: "generation_start",
        turn: 1,
        request: {
          chatHistory: [Message.user("private request")],
          documents: [],
          tools: [],
        },
        modelInfo: { provider: "test", defaultModel: "model" },
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
        type: "final",
        result: {
          status: "completed",
          runId: "native_run",
          text: "Safe",
          output: "Safe",
          usage: Usage.empty(),
          messages: [],
        },
      },
    ]);
    const events = await collect(agentToClientStream(native, { runId: "client_run" }));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private history");
    expect(serialized).not.toContain("private request");
    expect(serialized).not.toContain('"private":true');
    expect(events.find((event) => event.type === "run_end")).toMatchObject({
      runId: "client_run",
      metadata: { nativeRunId: "native_run" },
    });
  });

  it("masks native errors by default", async () => {
    const events = await collect(
      completionToClientStream(
        values<CompletionStreamEvent>([
          { type: "error", error: new Error("database password"), usage: Usage.empty() },
        ]),
      ),
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
      completionToClientStream(values(completion()), { mapOutput: () => undefined }),
    );
    expect(suppressed.find((event) => event.type === "run_end")).not.toHaveProperty("output");
    expect(JSON.stringify(suppressed)).not.toContain("secret");

    const nulled = await collect(
      completionToClientStream(values(completion()), { mapOutput: () => null }),
    );
    expect(nulled.find((event) => event.type === "run_end")).toMatchObject({ output: null });
  });

  it("emits final-only sources and provider tool calls without duplicating streamed values", async () => {
    const sharedSource = { type: "url" as const, url: "https://example.com/a", id: "source_a" };
    const sharedToolCall = { id: "provider_a", name: "search", status: "completed" };
    const events = await collect(
      completionToClientStream(
        values<CompletionStreamEvent>([
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
      ),
    );

    expect(events.filter((event) => event.type === "source")).toHaveLength(2);
    expect(events.filter((event) => event.type === "provider_tool_call")).toHaveLength(2);
  });

  it("finalizes anonymous reasoning without restarting or clearing it", async () => {
    const events = await collect(
      completionToClientStream(
        values<CompletionStreamEvent>([
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
                  content: [{ type: "summary", text: "Thinking" }],
                },
                { type: "text", text: "answer" },
              ],
              usage: Usage.empty(),
              rawResponse: {},
            },
          },
        ]),
      ),
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
      completionToClientStream(
        values<CompletionStreamEvent>([
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
      ),
    );
    const final = events.find((event) => event.type === "message_end");
    const reasoning = final?.parts?.filter((part) => part.type === "reasoning") ?? [];
    expect(reasoning.map((part) => part.text)).toEqual(["identified", "anonymous"]);
    expect(new Set(reasoning.map((part) => part.id)).size).toBe(2);
  });

  it("keeps tool results on the provider tool part using its explicit ID", async () => {
    const events = await collect(
      agentToClientStream(
        values<AgentStreamEvent>([
          {
            type: "tool_call",
            turn: 1,
            toolCall: {
              type: "tool_call",
              id: "provider_tool_1",
              function: { name: "weather", arguments: { city: "Jakarta" } },
            },
          },
          {
            type: "turn_end",
            turn: 1,
            response: {
              choice: [
                {
                  type: "tool_call",
                  id: "provider_tool_1",
                  function: { name: "weather", arguments: { city: "Jakarta" } },
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
            result: "Sunny",
          },
          {
            type: "final",
            result: {
              status: "completed",
              runId: "native_run",
              output: "Sunny",
              text: "Sunny",
              usage: Usage.empty(),
              messages: [],
            },
          },
        ]),
        { runId: "client_run" },
      ),
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
      type: "tool_call" as const,
      id: "provider_tool_a",
      function: { name: "weather", arguments: { city: "Jakarta" } },
    };
    const second = {
      type: "tool_call" as const,
      id: "provider_tool_b",
      function: { name: "weather", arguments: { city: "Bandung" } },
    };
    const events = await collect(
      agentToClientStream(
        values<AgentStreamEvent>([
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
            result: "Cloudy",
          },
          {
            type: "tool_result",
            turn: 1,
            toolName: "weather",
            toolCallId: "provider_tool_a",
            internalCallId: "internal_a",
            args: '{"city":"Jakarta"}',
            result: "Sunny",
          },
          {
            type: "final",
            result: {
              status: "completed",
              runId: "native_run",
              output: "done",
              text: "done",
              usage: Usage.empty(),
              messages: [],
            },
          },
        ]),
      ),
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
});

describe("protocol and transport", () => {
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
              protocol: "anvia.client.v1",
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
              "x-anvia-stream-protocol": "anvia.client.v1",
            },
          },
        ),
    });

    const frames = await collect(transport.send({ messages: [] }));
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

  it("frames direct streams even though no HTTP boundary is involved", async () => {
    const transport = createDirectClientTransport((_request: ClientStreamRequest) =>
      values<ClientStreamEvent>([
        { type: "run_start", runId: "run_1", source: "completion" },
        { type: "run_end", runId: "run_1", status: "completed" },
      ]),
    );
    const frames = await collect(transport.send({ messages: [] }));
    expect(frames.map((frame) => frame.type)).toEqual([
      "stream_start",
      "stream_event",
      "stream_event",
      "stream_end",
    ]);
    expect(frames[0]).toMatchObject({ protocol: "anvia.client.v1", resumable: false });
  });

  it("propagates direct transport cancellation into the handled stream", async () => {
    let finishNext: ((result: IteratorResult<ClientStreamEvent>) => void) | undefined;
    let closed = false;
    const transport = createDirectClientTransport((_request: ClientStreamRequest, options) => ({
      [Symbol.asyncIterator]() {
        expect(options.signal).toBeDefined();
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
    }));
    const controller = new AbortController();
    const iterator = transport
      .send({ messages: [] }, { signal: controller.signal })
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
        protocol: "anvia.client.v1",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      },
      {
        type: "stream_start",
        protocol: "anvia.client.v1",
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
            "x-anvia-stream-protocol": "anvia.client.v1",
          },
        }),
    });

    await expect(collect(transport.send({ messages: [] }))).rejects.toThrow(
      "more than one stream_start",
    );
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
                protocol: "anvia.client.v1",
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
                "x-anvia-stream-protocol": "anvia.client.v1",
              },
            },
          ),
      });
    }
    const request: ClientStreamRequest = {
      messages: [],
      resume: { streamId: "expected", after: 2 },
    };

    await expect(collect(transportFor("wrong", true).send(request))).rejects.toThrow(
      "streamId does not match",
    );
    await expect(collect(transportFor("expected", false).send(request))).rejects.toThrow(
      "must identify a resumable stream",
    );
  });

  it("keeps user metadata lossless and stores generated state separately", () => {
    const afterMessage = applyClientStreamEvent(
      [{ id: "assistant_1", role: "assistant", parts: [], metadata: "user-metadata" }],
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

    expect(afterRun[0]?.metadata).toBe("user-metadata");
    expect(afterRun[0]?.generation).toMatchObject({ runId: "run_1", status: "completed" });
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
