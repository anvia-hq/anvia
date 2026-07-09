import {
  AssistantContent,
  type CompletionStreamEvent,
  Message,
  Usage,
} from "@anvia/core/completion";
import type { AgentStreamEvent } from "@anvia/core/request";
import type { UIMessage, UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CreateChatRequestArgs,
  createChatTransport,
  createFetchTransport,
  EventStreamHttpError,
  type EventTransport,
  fetchEventStream,
  initialMessagesFromMemory,
  type ResumableStreamEnvelope,
  readJsonlStream,
  readSseStream,
  useChat,
} from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("@anvia/react transports", () => {
  it("reads jsonl streams", async () => {
    const parsed = await collect<{ type: string }>(
      readJsonlStream(streamFrom('{"type":"one"}\n{"type":"two"}\n')),
    );

    expect(parsed).toEqual([{ type: "one" }, { type: "two" }]);
  });

  it("reads server-sent event streams", async () => {
    const parsed = await collect<{ type: string; text: string }>(
      readSseStream(streamFrom('event: text\ndata: {"type":"text_delta","text":"hello"}\n\n')),
    );

    expect(parsed).toEqual([{ type: "text_delta", text: "hello" }]);
  });

  it("fetches event streams and infers sse content type", async () => {
    const parsed = await collect<{ type: string }>(
      fetchEventStream("https://example.test/events", {
        fetch: async () =>
          new Response(streamFrom('data: {"type":"one"}\n\n'), {
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          }),
      }),
    );

    expect(parsed).toEqual([{ type: "one" }]);
  });

  it("throws typed HTTP errors with response bodies", async () => {
    let error: unknown;

    try {
      await collect(
        fetchEventStream("https://example.test/events", {
          fetch: async () => new Response("nope", { status: 500 }),
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EventStreamHttpError);
    expect((error as EventStreamHttpError).response.status).toBe(500);
    expect((error as EventStreamHttpError).body).toBe("nope");
  });

  it("creates fetch transports", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(streamFrom(`${JSON.stringify({ type: "body", body: init?.body })}\n`)),
    );
    const transport = createFetchTransport<{ message: string }, { type: string }>({
      endpoint: "https://example.test/chat",
      fetch: fetchMock,
    });

    const parsed = await collect(transport.send({ message: "hi" }));

    expect(parsed).toEqual([{ type: "body", body: '{"message":"hi"}' }]);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("does not add an implicit body for GET or HEAD transports", async () => {
    for (const method of ["GET", "HEAD"]) {
      const fetchMock = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response(streamFrom('{"type":"ok"}\n')),
      );
      const transport = createFetchTransport<{ message: string }, { type: string }>({
        endpoint: "https://example.test/events",
        method,
        fetch: fetchMock,
      });

      await collect(transport.send({ message: "hi" }));

      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init?.method).toBe(method);
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
    }
  });

  it("passes custom fetch transport options and maps events", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(streamFrom('{"ok":true}\n')),
    );
    const transport = createFetchTransport<{ id: string }, { mapped: boolean }>({
      endpoint: (request) => `https://example.test/items/${request.id}`,
      method: "PATCH",
      fetch: fetchMock,
      headers: (request) => ({
        "x-request": request.id,
        "x-override": "base",
      }),
      body: (request) => `payload-${request.id}`,
      init: { credentials: "include" },
      mapEvent: (event) => ({ mapped: (event as { ok?: boolean }).ok === true }),
    });

    const parsed = await collect(
      transport.send(
        { id: "42" },
        {
          headers: {
            "x-extra": "yes",
            "x-override": "transport",
          },
        },
      ),
    );

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(String(input)).toBe("https://example.test/items/42");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe("payload-42");
    expect(init?.credentials).toBe("include");
    expect(headers.get("x-request")).toBe("42");
    expect(headers.get("x-extra")).toBe("yes");
    expect(headers.get("x-override")).toBe("transport");
    expect(parsed).toEqual([{ mapped: true }]);
  });

  it("creates chat transports as fetch transports", async () => {
    const transport = createChatTransport<UIStreamRequest, UIStreamEvent>({
      endpoint: "https://example.test/chat",
      fetch: async () =>
        new Response(
          streamFrom(
            '{"type":"message_start","message":{"id":"msg_1","role":"assistant","parts":[]}}\n',
          ),
        ),
    });

    await expect(collect(transport.send({ messages: [], stream: true }))).resolves.toMatchObject([
      { type: "message_start" },
    ]);
  });
});

describe("@anvia/react useChat", () => {
  it("creates initial UI messages from memory messages", () => {
    const memoryMessages = [
      Message.user("Where is order A-100?"),
      Message.assistant([
        AssistantContent.toolCall("call_1", "lookup_order", { orderId: "A-100" }),
      ]),
      Message.toolResult("call_1", { status: "shipped" }),
      Message.assistant("Order A-100 has shipped."),
    ];

    const initialMessages = initialMessagesFromMemory(memoryMessages);

    expect(initialMessages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "Where is order A-100?" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            toolName: "lookup_order",
            toolCallId: "call_1",
            state: "output-available",
            input: { orderId: "A-100" },
            output: '{"status":"shipped"}',
          },
        ],
      },
      { role: "assistant", parts: [{ type: "text", text: "Order A-100 has shipped." }] },
    ]);
  });

  it("hydrates useChat with initial messages created from memory", () => {
    const memoryMessages = [Message.user("hello"), Message.assistant("hi")];
    const initialMessages = initialMessagesFromMemory(memoryMessages);
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: vi.fn(async function* (): AsyncIterable<UIStreamEvent> {
        yield* [];
      }),
    };

    const { result } = renderHook(() => useChat({ transport, initialMessages }));

    expect(result.current.messages).toEqual(initialMessages);
  });

  it("sends converted core messages and applies UI stream events", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages).toHaveLength(1);
        expect(request.messages[0]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "hi" }],
        });
        expect(request.stream).toBe(true);
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
        yield {
          type: "text_delta",
          messageId: "assistant_1",
          partId: "assistant_1_text",
          delta: "Hel",
        };
        yield {
          type: "text_delta",
          messageId: "assistant_1",
          partId: "assistant_1_text",
          delta: "lo",
        };
        yield {
          type: "message_end",
          messageId: "assistant_1",
          metadata: { providerMessageId: "provider_1" },
        };
      },
    };

    const { result } = renderHook(() => useChat({ transport, onEvent }));

    await act(async () => {
      await result.current.sendMessage({ text: "hi", id: "user_1" });
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.text).toBe("Hello");
    expect(result.current.messages).toMatchObject([
      { id: "user_1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "assistant_1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
    expect(result.current.events).toHaveLength(4);
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  it("creates endpoint-backed chat transports", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          streamFrom(
            `${[
              '{"type":"text_delta","delta":"hi"}',
              '{"type":"final","response":{"choice":[{"type":"text","text":"hi"}],"usage":{"inputTokens":0,"outputTokens":0,"totalTokens":0,"cachedInputTokens":0,"cacheCreationInputTokens":0},"rawResponse":{}}}',
            ].join("\n")}\n`,
          ),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({ endpoint: "https://example.test/chat" }));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      stream: true,
    });
    expect(result.current.text).toBe("hi");
  });

  it("unwraps resumable stream envelopes and persists active chat resume state", async () => {
    let continueStream!: () => void;
    const onEvent = vi.fn();
    const transport: EventTransport<
      UIStreamRequest,
      UIStreamEvent | ResumableStreamEnvelope<UIStreamEvent>
    > = {
      send: async function* () {
        yield { type: "stream_start", streamId: "run_1", eventId: 0 };
        yield {
          type: "stream_event",
          streamId: "run_1",
          eventId: 1,
          event: {
            type: "message_start",
            message: { id: "assistant_1", role: "assistant", parts: [] },
          },
        };
        yield {
          type: "stream_event",
          streamId: "run_1",
          eventId: 2,
          event: {
            type: "text_delta",
            messageId: "assistant_1",
            partId: "assistant_1_text",
            delta: "Hi",
          },
        };
        await new Promise<void>((resolve) => {
          continueStream = resolve;
        });
        yield { type: "stream_end", streamId: "run_1", eventId: 2, status: "completed" };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, resume: { key: "thread_1" }, onEvent }),
    );

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send("hello");
    });
    await vi.waitFor(() => {
      expect(result.current.text).toBe("Hi");
    });

    const stored = JSON.parse(
      window.sessionStorage.getItem("anvia:chat-resume:thread_1") ?? "null",
    ) as { streamId?: string; lastEventId?: number; messages?: UIMessage[] } | null;
    expect(stored).toMatchObject({
      streamId: "run_1",
      lastEventId: 2,
    });
    expect(stored?.messages?.at(-1)).toMatchObject({
      id: "assistant_1",
      role: "assistant",
      parts: [{ type: "text", text: "Hi" }],
    });
    expect(result.current.streamId).toBe("run_1");
    expect(result.current.events).toEqual([
      { type: "message_start", message: { id: "assistant_1", role: "assistant", parts: [] } },
      {
        type: "text_delta",
        messageId: "assistant_1",
        partId: "assistant_1_text",
        delta: "Hi",
      },
    ]);
    expect(onEvent).toHaveBeenCalledTimes(2);

    await act(async () => {
      continueStream();
      await sendPromise;
    });

    expect(result.current.streamId).toBeUndefined();
    expect(window.sessionStorage.getItem("anvia:chat-resume:thread_1")).toBeNull();
  });

  it("auto-resumes chat streams with the same endpoint request body", async () => {
    window.sessionStorage.setItem(
      "anvia:chat-resume:thread_1",
      JSON.stringify({
        version: 1,
        streamId: "run_1",
        lastEventId: 1,
        messages: [
          {
            id: "user_1",
            role: "user",
            parts: [{ id: "part_1", type: "text", text: "hello" }],
          },
        ],
      }),
    );
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          streamFrom(
            `${[
              '{"type":"stream_start","streamId":"run_1","eventId":0}',
              '{"type":"stream_event","streamId":"run_1","eventId":2,"event":{"type":"message_start","message":{"id":"assistant_1","role":"assistant","parts":[]}}}',
              '{"type":"stream_event","streamId":"run_1","eventId":3,"event":{"type":"text_delta","messageId":"assistant_1","partId":"assistant_1_text","delta":"there"}}',
              '{"type":"stream_end","streamId":"run_1","eventId":3,"status":"completed"}',
            ].join("\n")}\n`,
          ),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat({
        endpoint: "https://example.test/chat",
        resume: { key: "thread_1" },
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.text).toBe("there");
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      stream: true,
      resume: {
        streamId: "run_1",
        after: 1,
      },
    });
    expect(result.current.isResuming).toBe(false);
    expect(window.sessionStorage.getItem("anvia:chat-resume:thread_1")).toBeNull();
  });

  it("ignores resume storage failures", async () => {
    const storage: Storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      key: vi.fn(() => null),
      removeItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
    };
    const transport: EventTransport<
      UIStreamRequest,
      UIStreamEvent | ResumableStreamEnvelope<UIStreamEvent>
    > = {
      send: async function* () {
        yield { type: "stream_start", streamId: "run_1", eventId: 0 };
        yield {
          type: "stream_event",
          streamId: "run_1",
          eventId: 1,
          event: {
            type: "message_start",
            message: { id: "assistant_1", role: "assistant", parts: [] },
          },
        };
        yield {
          type: "stream_event",
          streamId: "run_1",
          eventId: 2,
          event: {
            type: "text_delta",
            messageId: "assistant_1",
            partId: "assistant_1_text",
            delta: "Hi",
          },
        };
        yield { type: "stream_end", streamId: "run_1", eventId: 2, status: "completed" };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, resume: { key: "thread_1", storage } }),
    );

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.text).toBe("Hi");
    expect(storage.getItem).toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it("sends attachment-only messages", async () => {
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages).toEqual([
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", data: "aGVsbG8=", mediaType: "image/png" },
              },
            ],
          },
        ]);
        yield* [];
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.sendMessage({
        attachments: [
          {
            type: "image",
            mediaType: "image/png",
            data: "aGVsbG8=",
          },
        ],
      });
    });

    expect(result.current.messages[0]?.parts).toEqual([
      expect.objectContaining({
        type: "attachment",
        attachment: expect.objectContaining({
          type: "image",
          mediaType: "image/png",
          data: "aGVsbG8=",
        }),
      }),
    ]);
  });

  it("exposes configured chat suggestions", () => {
    const suggestions = [{ id: "s1", prompt: "Summarize this", label: "Summarize" }];
    const { result } = renderHook(() => useChat({ suggestions }));

    expect(result.current.suggestions).toBe(suggestions);
  });

  it("passes core and UI messages to custom chat request factories", async () => {
    type CustomRequest = {
      messages: unknown[];
      uiMessages: unknown[];
      stream: true;
    };
    const createRequest = vi.fn((args: CreateChatRequestArgs) => ({
      messages: args.coreMessages,
      uiMessages: args.uiMessages,
      stream: true as const,
    }));
    const transport: EventTransport<CustomRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages[0]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "hello" }],
        });
        expect(request.uiMessages[0]).toMatchObject({
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        });
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
      },
    };
    const { result } = renderHook(() => useChat<CustomRequest>({ transport, createRequest }));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(createRequest).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "hello" })],
        }),
      ],
      uiMessages: [
        expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "hello" })],
        }),
      ],
      coreMessages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
  });

  it("reports UI conversion errors before sending chat requests", async () => {
    const onError = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: vi.fn(async function* (): AsyncIterable<UIStreamEvent> {
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
      }),
    };
    const invalidMessage: UIMessage = {
      id: "bad_user",
      role: "user",
      parts: [{ id: "bad_part", type: "data", name: "custom", data: { value: 1 } }],
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        initialMessages: [invalidMessage],
        onError,
      }),
    );

    await act(async () => {
      await result.current.send("hello");
    });

    expect(transport.send).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeInstanceOf(TypeError);
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it("applies raw completion stream events", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield { type: "text_delta", delta: "Hel" };
        yield { type: "text_delta", delta: "lo" };
        yield {
          type: "final",
          response: {
            choice: [AssistantContent.text("Hello")],
            usage: Usage.empty(),
            rawResponse: {},
            messageId: "provider_1",
          },
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("Hello");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
  });

  it("merges raw completion tool call deltas", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call_delta",
          id: "tool_1",
          name: "lookup",
          argumentsDelta: '{"query"',
        };
        yield {
          type: "tool_call_delta",
          id: "tool_1",
          argumentsDelta: ':"Anvia"}',
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("lookup");
    });

    expect(result.current.messages[1]?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        toolName: "lookup",
        toolCallId: "tool_1",
        state: "input-streaming",
        input: '{"query":"Anvia"}',
      }),
    ]);
  });

  it("applies raw agent stream events", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("fc_1", "add", { x: 2, y: 5 }, "call_1"),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "add",
          toolCallId: "call_1",
          internalCallId: "internal_1",
          args: '{"x":2,"y":5}',
          result: "7",
          structuredResult: { value: 7 },
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "7" };
        yield {
          type: "final",
          runId: "run_1",
          output: "7",
          usage: Usage.empty(),
          messages: [],
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("add");
    });

    expect(result.current.text).toBe("7");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "add" }] },
      {
        role: "assistant",
        metadata: { runId: "run_1" },
      },
    ]);
    const toolParts = result.current.messages[1]?.parts.filter((part) => part.type === "tool");
    expect(toolParts).toEqual([
      expect.objectContaining({
        type: "tool",
        toolName: "add",
        toolCallId: "fc_1",
        callId: "call_1",
        state: "output-available",
        input: { x: 2, y: 5 },
        output: { value: 7 },
      }),
    ]);
    expect(result.current.messages[1]?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "7" })]),
    );
  });

  it("keeps raw text deltas after tool results in chronological order", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield { type: "text_delta", turn: 1, delta: "before" };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall(
            "web_1",
            "webSearch",
            { query: "AAPL stock price market analysis 2025" },
            "call_web_1",
          ),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "webSearch",
          toolCallId: "call_web_1",
          internalCallId: "internal_web_1",
          args: '{"query":"AAPL stock price market analysis 2025"}',
          result: "price result",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "after" };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("report");
    });

    expect(assistantPartSummary(result.current.messages)).toEqual([
      { type: "text", text: "before" },
      {
        type: "tool",
        toolName: "webSearch",
        toolCallId: "web_1",
        callId: "call_web_1",
        state: "output-available",
        input: { query: "AAPL stock price market analysis 2025" },
        output: "price result",
      },
      { type: "text", text: "after" },
    ]);
  });

  it("keeps text after a tool-first assistant run after the completed tool", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("exec_1", "exec_command", { command: "ls" }),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "exec_command",
          internalCallId: "internal_exec_1",
          args: '{"command":"ls"}',
          result: "file.txt",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "verified" };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("list");
    });

    expect(assistantPartSummary(result.current.messages)).toEqual([
      {
        type: "tool",
        toolName: "exec_command",
        toolCallId: "exec_1",
        state: "output-available",
        input: { command: "ls" },
        output: "file.txt",
      },
      { type: "text", text: "verified" },
    ]);
  });

  it("preserves ordering across multiple tool calls in one assistant run", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield { type: "reasoning_delta", turn: 1, delta: "thinking..." };
        yield {
          type: "text_delta",
          turn: 1,
          delta: "Let me gather the latest information.",
        };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall(
            "web_1",
            "webSearch",
            { query: "AAPL stock price market analysis 2025" },
            "call_web_1",
          ),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "webSearch",
          toolCallId: "call_web_1",
          internalCallId: "internal_web_1",
          args: '{"query":"AAPL stock price market analysis 2025"}',
          result: "price result",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "Let me get a few more details." };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall(
            "web_2",
            "webSearch",
            { query: "AAPL technical analysis 2025" },
            "call_web_2",
          ),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "webSearch",
          toolCallId: "call_web_2",
          internalCallId: "internal_web_2",
          args: '{"query":"AAPL technical analysis 2025"}',
          result: "technical result",
        } as unknown as AgentStreamEvent;
        yield {
          type: "text_delta",
          turn: 1,
          delta: "Excellent. Now let me create the PDF report.",
        };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("exec_1", "exec_command", { command: "ls" }),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "exec_command",
          internalCallId: "internal_exec_1",
          args: '{"command":"ls"}',
          result: "report.pdf",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "Let me verify the file." };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("report");
    });

    expect(assistantPartSummary(result.current.messages)).toEqual([
      { type: "text", text: "Let me gather the latest information." },
      expect.objectContaining({ type: "tool", toolName: "webSearch", toolCallId: "web_1" }),
      { type: "text", text: "Let me get a few more details." },
      expect.objectContaining({ type: "tool", toolName: "webSearch", toolCallId: "web_2" }),
      { type: "text", text: "Excellent. Now let me create the PDF report." },
      expect.objectContaining({
        type: "tool",
        toolName: "exec_command",
        toolCallId: "exec_1",
        input: { command: "ls" },
        output: "report.pdf",
      }),
      { type: "text", text: "Let me verify the file." },
    ]);
  });

  it("matches final and replay order while keeping sandbox tool results visible", async () => {
    const finalMessages = [
      Message.user("report"),
      Message.assistant([
        AssistantContent.text("Let me gather the latest information."),
        AssistantContent.toolCall(
          "web_1",
          "webSearch",
          { query: "AAPL stock price market analysis 2025" },
          "call_web_1",
        ),
      ]),
      Message.toolResult("web_1", "price result", {
        callId: "call_web_1",
        toolName: "webSearch",
      }),
      Message.assistant([
        AssistantContent.text("Let me get a few more details."),
        AssistantContent.toolCall(
          "web_2",
          "webSearch",
          { query: "AAPL technical analysis 2025" },
          "call_web_2",
        ),
      ]),
      Message.toolResult("web_2", "technical result", {
        callId: "call_web_2",
        toolName: "webSearch",
      }),
      Message.assistant([
        AssistantContent.text("Excellent. Now let me create the PDF report."),
        AssistantContent.toolCall("exec_1", "exec_command", { command: "ls" }),
      ]),
      Message.toolResult("exec_1", "report.pdf", { toolName: "exec_command" }),
      Message.assistant("Let me verify the file."),
    ];
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield {
          type: "text_delta",
          turn: 1,
          delta: "Let me gather the latest information.",
        };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall(
            "web_1",
            "webSearch",
            { query: "AAPL stock price market analysis 2025" },
            "call_web_1",
          ),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "webSearch",
          toolCallId: "call_web_1",
          internalCallId: "internal_web_1",
          args: '{"query":"AAPL stock price market analysis 2025"}',
          result: "price result",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "Let me get a few more details." };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall(
            "web_2",
            "webSearch",
            { query: "AAPL technical analysis 2025" },
            "call_web_2",
          ),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "webSearch",
          toolCallId: "call_web_2",
          internalCallId: "internal_web_2",
          args: '{"query":"AAPL technical analysis 2025"}',
          result: "technical result",
        } as unknown as AgentStreamEvent;
        yield {
          type: "text_delta",
          turn: 1,
          delta: "Excellent. Now let me create the PDF report.",
        };
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("exec_1", "exec_command", { command: "ls" }),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "exec_command",
          internalCallId: "internal_exec_1",
          args: '{"command":"ls"}',
          result: "report.pdf",
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "Let me verify the file." };
        yield {
          type: "final",
          runId: "run_1",
          output: "Let me verify the file.",
          usage: Usage.empty(),
          messages: finalMessages,
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("report");
    });

    const finalSummary = assistantPartSummary(result.current.messages);
    const replaySummary = assistantPartSummary(initialMessagesFromMemory(finalMessages));
    expect(finalSummary).toEqual(replaySummary);
    expect(finalSummary).toEqual([
      { type: "text", text: "Let me gather the latest information." },
      expect.objectContaining({
        type: "tool",
        toolName: "webSearch",
        toolCallId: "web_1",
        callId: "call_web_1",
        state: "output-available",
      }),
      { type: "text", text: "Let me get a few more details." },
      expect.objectContaining({
        type: "tool",
        toolName: "webSearch",
        toolCallId: "web_2",
        callId: "call_web_2",
        state: "output-available",
      }),
      { type: "text", text: "Excellent. Now let me create the PDF report." },
      {
        type: "tool",
        toolName: "exec_command",
        toolCallId: "exec_1",
        state: "output-available",
        input: { command: "ls" },
        output: "report.pdf",
      },
      { type: "text", text: "Let me verify the file." },
    ]);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { runId: "run_1" },
    });
  });

  it("supports custom event mapping for non-UI streams", async () => {
    const transport: EventTransport<UIStreamRequest, { type: string; delta?: string }> = {
      send: async function* () {
        yield { type: "token", delta: "ok" };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        eventToDelta: (event) => (event.type === "token" ? event.delta : undefined),
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("ok");
  });

  it("lets custom delta mapping override raw Anvia event names", async () => {
    const transport: EventTransport<UIStreamRequest, { type: "text_delta"; delta: string }> = {
      send: async function* () {
        yield { type: "text_delta", delta: "raw" };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        eventToDelta: (event) => (event.type === "text_delta" ? "custom" : undefined),
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("custom");
  });

  it("aborts active streams when stopped", async () => {
    let signal: AbortSignal | undefined;
    let sendPromise!: Promise<void>;
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (_request, options) {
        signal = options?.signal;
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      sendPromise = result.current.send("hi");
      await vi.waitFor(() => {
        expect(signal).toBeDefined();
      });
    });

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
    await sendPromise;
    expect(result.current.status).toBe("idle");
  });

  it("keeps synchronous message updates available to back-to-back sends", async () => {
    const requests: UIStreamRequest[] = [];
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* (request) {
        requests.push(request);
        yield { type: "text_delta", delta: `reply-${requests.length}` };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await Promise.all([result.current.send("first"), result.current.send("second")]);
    });

    expect(requests[1]?.messages).toMatchObject([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
  });

  it("keeps a newer chat stream active when an older stream aborts", async () => {
    const requests: UIStreamRequest[] = [];
    let resolveSecond!: () => void;
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* (request, options) {
        requests.push(request);

        if (requests.length === 1) {
          yield { type: "text_delta", delta: "partial" };
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
          return;
        }

        yield { type: "text_delta", delta: "done" };
        await new Promise<void>((resolve) => {
          resolveSecond = resolve;
        });
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    let firstSend!: Promise<void>;
    act(() => {
      firstSend = result.current.send("first");
    });
    await vi.waitFor(() => {
      expect(result.current.text).toBe("partial");
    });

    let secondSend!: Promise<void>;
    act(() => {
      secondSend = result.current.send("second");
    });
    await vi.waitFor(() => {
      expect(result.current.text).toBe("done");
    });
    await firstSend;

    expect(result.current.status).toBe("streaming");
    expect(requests[1]?.messages).toMatchObject([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
    expect(requests[1]?.messages).toHaveLength(2);

    await act(async () => {
      resolveSecond();
      await secondSend;
    });

    expect(result.current.status).toBe("idle");
  });

  it("tracks Studio approval and question events", async () => {
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: {
            id: "approval-1",
            toolName: "issue_refund",
            status: "pending",
            reason: "Review refund.",
          },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [
              {
                id: "priority",
                question: "Priority?",
                choices: [{ label: "High", value: "high" }],
              },
            ],
          },
        };
        yield {
          type: "tool_approval_result",
          approval: {
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
            reason: "Approved.",
          },
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport, humanInput: { endpoint: "" } }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.humanInput.approvals.all).toEqual([
      expect.objectContaining({
        id: "approval-1",
        toolName: "issue_refund",
        status: "approved",
      }),
    ]);
    expect(result.current.humanInput.approvals.pending).toEqual([]);
    expect(result.current.humanInput.questions.pending).toEqual([
      expect.objectContaining({
        id: "question-1",
        toolName: "ask_question",
        status: "pending",
      }),
    ]);
  });

  it("submits Studio approval decisions and question answers to default endpoints", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/approvals/approval-1/decision") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ approved: true, reason: "looks good" }));
        return new Response(
          JSON.stringify({
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
          }),
        );
      }
      if (url === "/questions/question-1/answer") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            answers: [{ questionId: "priority", answer: "High", choice: "high" }],
          }),
        );
        return new Response(
          JSON.stringify({
            id: "question-1",
            toolName: "ask_question",
            status: "answered",
            questions: [],
            answers: [{ questionId: "priority", answer: "High", choice: "high" }],
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: { id: "approval-1", toolName: "issue_refund", status: "pending" },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [
              {
                id: "priority",
                question: "Priority?",
                choices: [{ label: "High", value: "high" }],
              },
            ],
          },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, humanInput: { endpoint: "", fetch: fetchMock as typeof fetch } }),
    );

    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.approveTool("approval-1", "looks good");
      await result.current.answerToolQuestion("question-1", [
        { questionId: "priority", answer: "High", choice: "high" },
      ]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.humanInput.approvals.pending).toEqual([]);
    expect(result.current.humanInput.questions.pending).toEqual([]);
    expect(result.current.humanInput.questions.all[0]?.answers).toEqual([
      { questionId: "priority", answer: "High", choice: "high" },
    ]);
  });

  it("supports custom human input event mapping and handlers", async () => {
    const decideApproval = vi.fn(async () => ({
      id: "a1",
      toolName: "custom_tool",
      status: "rejected" as const,
    }));
    const answerQuestion = vi.fn(async () => ({
      id: "q1",
      toolName: "custom_question",
      status: "answered" as const,
      questions: [],
    }));
    const transport: EventTransport<UIStreamRequest, { kind: string; payload: unknown }> = {
      send: async function* () {
        yield {
          kind: "approval",
          payload: { id: "a1", toolName: "custom_tool", status: "pending" },
        };
        yield {
          kind: "question",
          payload: { id: "q1", toolName: "custom_question", status: "pending", questions: [] },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        humanInput: {
          eventToApproval: (event) =>
            event.kind === "approval"
              ? (event.payload as {
                  id: string;
                  toolName: string;
                  status: "pending";
                })
              : undefined,
          eventToQuestion: (event) =>
            event.kind === "question"
              ? (event.payload as {
                  id: string;
                  toolName: string;
                  status: "pending";
                  questions: [];
                })
              : undefined,
          decideApproval,
          answerQuestion,
        },
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.rejectTool("a1", "no");
      await result.current.answerToolQuestion("q1", []);
    });

    expect(decideApproval).toHaveBeenCalledWith({
      approvalId: "a1",
      approved: false,
      reason: "no",
      approval: { id: "a1", toolName: "custom_tool", status: "pending" },
    });
    expect(answerQuestion).toHaveBeenCalledWith({
      questionId: "q1",
      answers: [],
      question: { id: "q1", toolName: "custom_question", status: "pending", questions: [] },
    });
    expect(result.current.humanInput.approvals.all[0]?.status).toBe("rejected");
    expect(result.current.humanInput.questions.all[0]?.status).toBe("answered");
  });

  it("guards duplicate human input submissions while a request is in flight", async () => {
    const pendingResponses: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: { id: "approval-1", toolName: "issue_refund", status: "pending" },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [],
          },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, humanInput: { endpoint: "", fetch: fetchMock as typeof fetch } }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.approveTool("approval-1");
    });
    expect(result.current.decidingApprovals.has("approval-1")).toBe(true);
    await act(async () => {
      await result.current.approveTool("approval-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingResponses[0]?.(
        new Response(
          JSON.stringify({
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
          }),
        ),
      );
      await first;
    });

    expect(result.current.decidingApprovals.has("approval-1")).toBe(false);

    let questionAnswer!: Promise<void>;
    await act(async () => {
      questionAnswer = result.current.answerToolQuestion("question-1", []);
    });
    expect(result.current.answeringQuestions.has("question-1")).toBe(true);
    await act(async () => {
      await result.current.answerToolQuestion("question-1", []);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingResponses[1]?.(
        new Response(
          JSON.stringify({
            id: "question-1",
            toolName: "ask_question",
            status: "answered",
            questions: [],
          }),
        ),
      );
      await questionAnswer;
    });

    expect(result.current.answeringQuestions.has("question-1")).toBe(false);
  });
});

type AssistantPartSummary =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "tool";
      toolName: string;
      toolCallId: string;
      callId?: string;
      state: "input-streaming" | "input-available" | "output-available" | "error";
      input?: unknown;
      output?: unknown;
    };

function assistantPartSummary(messages: UIMessage[]): AssistantPartSummary[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") {
      return [];
    }
    return message.parts.flatMap((part): AssistantPartSummary[] => {
      if (part.type === "text") {
        return [{ type: "text", text: part.text }];
      }
      if (part.type === "tool") {
        return [
          {
            type: "tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            ...(part.callId === undefined ? {} : { callId: part.callId }),
            state: part.state,
            ...(part.input === undefined ? {} : { input: part.input }),
            ...(part.output === undefined ? {} : { output: part.output }),
          },
        ];
      }
      return [];
    });
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const event of events) {
    items.push(event);
  }
  return items;
}

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
