import type { AgentStreamEvent } from "@anvia/core/agent";
import { AssistantContent, type CompletionStreamEvent, Usage } from "@anvia/core/completion";
import type { UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createChatTransport,
  createFetchTransport,
  EventStreamHttpError,
  type EventTransport,
  fetchEventStream,
  readJsonlStream,
  readSseStream,
  useChat,
} from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    const transport = createFetchTransport<{ message: string }, { type: string }>({
      endpoint: "https://example.test/chat",
      fetch: async (_input, init) =>
        new Response(streamFrom(`${JSON.stringify({ type: "body", body: init?.body })}\n`)),
    });

    const parsed = await collect(transport.send({ message: "hi" }));

    expect(parsed).toEqual([{ type: "body", body: '{"message":"hi"}' }]);
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
  it("sends full UI messages and applies UI stream events", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages).toHaveLength(1);
        expect(request.messages[0]).toMatchObject({
          role: "user",
          parts: [{ type: "text", text: "hi" }],
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
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      stream: true,
    });
    expect(result.current.text).toBe("hi");
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

  it("applies raw agent stream events", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("tool_1", "add", { x: 2, y: 5 }, "call_1"),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "add",
          toolCallId: "call_1",
          internalCallId: "tool_1",
          args: '{"x":2,"y":5}',
          result: "7",
        };
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
    expect(result.current.messages[1]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool",
          toolName: "add",
          state: "output-available",
          output: "7",
        }),
        expect.objectContaining({ type: "text", text: "7" }),
      ]),
    );
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
});

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
