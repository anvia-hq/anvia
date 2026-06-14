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

  it("reads jsonl streams across chunks, CRLF, blank lines, and trailing data", async () => {
    const parsed = await collect<{ type: string }>(
      readJsonlStream(
        streamFromChunks(['{"type":"one"}\r', "\n\n", '{"type":"two"}', "\n", '{"type":"three"}']),
      ),
    );

    expect(parsed).toEqual([{ type: "one" }, { type: "two" }, { type: "three" }]);
  });

  it("reads server-sent event streams", async () => {
    const parsed = await collect<{ type: string; text: string }>(
      readSseStream(streamFrom('event: text\ndata: {"type":"text_delta","text":"hello"}\n\n')),
    );

    expect(parsed).toEqual([{ type: "text_delta", text: "hello" }]);
  });

  it("reads server-sent events across chunks with comments and multiline data", async () => {
    const parsed = await collect<{ type: string; value: string }>(
      readSseStream(
        streamFromChunks([
          ": ignored\n",
          "retry: 1000\n",
          "event: text\n",
          'data: {"type":"one",',
          '"value":"hello',
          "\\n",
          'world"}\n\n',
          'data: {"type":"two","value":"done"}',
        ]),
      ),
    );

    expect(parsed).toEqual([
      { type: "one", value: "hello\nworld" },
      { type: "two", value: "done" },
    ]);
  });

  it("fetches event streams as async iterables", async () => {
    const parsed = await collect<{ type: string }>(
      fetchEventStream("https://example.test/events", {
        fetch: async () =>
          new Response(streamFrom('{"type":"one"}\n'), {
            headers: { "content-type": "application/x-ndjson" },
          }),
      }),
    );

    expect(parsed).toEqual([{ type: "one" }]);
  });

  it("infers server-sent event format from response content type", async () => {
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

  it("throws when event responses do not include a body", async () => {
    await expect(
      collect(
        fetchEventStream("https://example.test/events", {
          fetch: async () => new Response(null),
        }),
      ),
    ).rejects.toThrow("Event stream response does not include a body");
  });

  it("throws when no fetch implementation is available", async () => {
    vi.stubGlobal("fetch", undefined);

    await expect(collect(fetchEventStream("https://example.test/events"))).rejects.toThrow(
      "fetchEventStream requires a fetch implementation",
    );
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

  it("creates fetch transports without custom fetch or request body", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(streamFrom('{"type":"ok"}\n')),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = createFetchTransport<{ message: string }, { type: string }>({
      endpoint: "https://example.test/chat",
      body: () => undefined,
    });

    const parsed = await collect(transport.send({ message: "hi" }));
    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(parsed).toEqual([{ type: "ok" }]);
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
  });

  it("creates fetch transports with endpoint functions and request options", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return new Response(
        streamFrom(
          `${JSON.stringify({
            type: "received",
            method: init?.method,
            body: init?.body,
            auth: headers.get("authorization"),
            requestHeader: headers.get("x-request"),
            signal: init?.signal === controller.signal,
          })}\n`,
        ),
      );
    });
    const transport = createFetchTransport<{ id: string }, { ok: boolean; type: string }>({
      endpoint: (request) => new URL(`https://example.test/chat/${request.id}`),
      method: "PUT",
      headers: async (request) => ({
        authorization: `Bearer ${request.id}`,
      }),
      body: (request) => `id=${request.id}`,
      init: { credentials: "include" },
      fetch: fetchMock,
      mapEvent: (event) => ({ ok: true, ...(event as { type: string }) }),
    });

    const parsed = await collect(
      transport.send(
        { id: "abc" },
        { headers: { "x-request": "test" }, signal: controller.signal },
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://example.test/chat/abc");
    expect(init).toMatchObject({
      body: "id=abc",
      credentials: "include",
      method: "PUT",
      signal: controller.signal,
    });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer abc");
    expect(new Headers(init?.headers).get("x-request")).toBe("test");
    expect(parsed).toEqual([
      {
        ok: true,
        type: "received",
        method: "PUT",
        body: "id=abc",
        auth: "Bearer abc",
        requestHeader: "test",
        signal: true,
      },
    ]);
  });

  it("creates chat transports as fetch transports", async () => {
    const transport = createChatTransport<{ message: string }, { type: string }>({
      endpoint: "https://example.test/chat",
      fetch: async () => new Response(streamFrom('{"type":"final","output":"done"}\n')),
    });

    await expect(collect(transport.send({ message: "hi" }))).resolves.toEqual([
      { type: "final", output: "done" },
    ]);
  });
});

describe("@anvia/react useChat", () => {
  it("streams deltas, replaces final output, and records events", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<
      { message: string; history: unknown[]; stream: true },
      { type: string; delta?: string; output?: string }
    > = {
      send: async function* (request) {
        expect(request).toEqual({ message: "hi", history: [], stream: true });
        yield { type: "text_delta", delta: "Hel" };
        yield { type: "text_delta", delta: "lo" };
        yield { type: "final", output: "Done" };
      },
    };

    const { result } = renderHook(() => useChat({ transport, onEvent }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.text).toBe("Done");
    expect(result.current.events).toEqual([
      { type: "text_delta", delta: "Hel" },
      { type: "text_delta", delta: "lo" },
      { type: "final", output: "Done" },
    ]);
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Done" },
    ]);
    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it("does not send empty input", async () => {
    const transport: EventTransport<unknown, unknown> = {
      send: vi.fn(async function* () {
        yield { type: "unexpected" };
      }),
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("   ");
    });

    expect(transport.send).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("throws when no transport or endpoint is configured", async () => {
    const { result } = renderHook(() => useChat());

    await expect(
      act(async () => {
        await result.current.send("hi");
      }),
    ).rejects.toThrow("useChat requires either transport or endpoint");
  });

  it("creates endpoint-backed chat transports", async () => {
    const fetchMock = vi.fn(
      async () => new Response(streamFrom('{"type":"text_delta","delta":"hi"}\n')),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({ endpoint: "https://example.test/chat" }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/chat", expect.any(Object));
    expect(result.current.text).toBe("hi");
  });

  it("ignores non-object default chat events", async () => {
    const transport: EventTransport<unknown, unknown> = {
      send: async function* () {
        yield "plain";
        yield null;
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.events).toEqual(["plain", null]);
    expect(result.current.text).toBe("");
  });

  it("handles errors and reset", async () => {
    const error = new Error("failed");
    const onError = vi.fn();
    const transport: EventTransport<unknown, unknown> = {
      send: () => failingEvents(error),
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        initialMessages: [{ id: "initial", role: "assistant", content: "hello" }],
        onError,
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(error);
    expect(onError).toHaveBeenCalledWith(error);

    act(() => {
      result.current.reset([{ id: "reset", role: "assistant", content: "reset" }]);
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.text).toBe("reset");
    expect(result.current.events).toEqual([]);
  });

  it("aborts active streams when stopped", async () => {
    let signal: AbortSignal | undefined;
    let sendPromise!: Promise<void>;
    const transport: EventTransport<unknown, unknown> = {
      send: async function* (_request, options) {
        signal = options?.signal;
        yield { type: "text_delta", delta: "hi" };
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
  return streamFromChunks([text]);
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function failingEvents(error: unknown): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw error;
        },
      };
    },
  };
}
