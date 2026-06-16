import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventTransport } from "../src";
import { useCompletion } from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("@anvia/react useCompletion", () => {
  it("streams deltas and replaces final output", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<
      { prompt: string; stream: true },
      { type: string; delta?: string; response?: { choice: { type: string; text: string }[] } }
    > = {
      send: async function* (request) {
        expect(request).toEqual({ prompt: "hello", stream: true });
        yield { type: "text_delta", delta: "Hel" };
        yield { type: "text_delta", delta: "lo" };
        yield {
          type: "final",
          response: { choice: [{ type: "text", text: "Hello, world!" }] },
        };
      },
    };

    const { result } = renderHook(() => useCompletion({ transport, onEvent }));

    await act(async () => {
      await result.current.complete("hello");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.completion).toBe("Hello, world!");
    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it("accumulates text deltas without final event", async () => {
    const transport: EventTransport<unknown, { type: string; delta?: string }> = {
      send: async function* () {
        yield { type: "text_delta", delta: "one" };
        yield { type: "text_delta", delta: " two" };
      },
    };

    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("hi");
    });

    expect(result.current.completion).toBe("one two");
    expect(result.current.status).toBe("idle");
  });

  it("does not send empty input", async () => {
    const transport: EventTransport<unknown, unknown> = {
      send: vi.fn(async function* () {
        yield { type: "unexpected" };
      }),
    };
    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("   ");
    });

    expect(transport.send).not.toHaveBeenCalled();
    expect(result.current.completion).toBe("");
  });

  it("throws when no transport or endpoint is configured", async () => {
    const { result } = renderHook(() => useCompletion());

    await expect(
      act(async () => {
        await result.current.complete("hi");
      }),
    ).rejects.toThrow("useCompletion requires either transport or endpoint");
  });

  it("creates endpoint-backed transports", async () => {
    const streamFrom = (text: string): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });

    const fetchMock = vi.fn(
      async () => new Response(streamFrom('{"type":"text_delta","delta":"hi"}\n')),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useCompletion({ endpoint: "https://example.test/completion" }),
    );

    await act(async () => {
      await result.current.complete("hello");
    });

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/completion", expect.any(Object));
    expect(result.current.completion).toBe("hi");
  });

  it("handles errors and reset", async () => {
    const error = new Error("failed");
    const onError = vi.fn();
    const transport: EventTransport<unknown, unknown> = {
      send: () => failingEvents(error),
    };
    const { result } = renderHook(() =>
      useCompletion({
        transport,
        initialCompletion: "previous",
        onError,
      }),
    );

    await act(async () => {
      await result.current.complete("hi");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(error);
    expect(onError).toHaveBeenCalledWith(error);

    act(() => {
      result.current.reset("reset value");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.completion).toBe("reset value");
  });

  it("resets to empty string by default", async () => {
    const { result } = renderHook(() => useCompletion({ initialCompletion: "initial" }));

    expect(result.current.completion).toBe("initial");

    act(() => {
      result.current.reset();
    });

    expect(result.current.completion).toBe("");
    expect(result.current.input).toBe("");
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
  });

  it("aborts active streams when stopped", async () => {
    let signal: AbortSignal | undefined;
    let completePromise!: Promise<void>;
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
    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      completePromise = result.current.complete("test");
      await vi.waitFor(() => {
        expect(signal).toBeDefined();
      });
    });

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
    await completePromise;
    expect(result.current.status).toBe("idle");
  });

  it("ignores non-object default completion events", async () => {
    const transport: EventTransport<unknown, unknown> = {
      send: async function* () {
        yield "plain";
        yield null;
      },
    };
    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("hi");
    });

    expect(result.current.completion).toBe("");
  });

  it("supports controlled input", async () => {
    const transport: EventTransport<unknown, { type: string; delta?: string }> = {
      send: async function* () {
        yield { type: "text_delta", delta: "ok" };
      },
    };
    const { result } = renderHook(() => useCompletion({ transport }));

    act(() => {
      result.current.setInput("my prompt");
    });

    expect(result.current.input).toBe("my prompt");

    await act(async () => {
      await result.current.complete();
    });

    expect(result.current.completion).toBe("ok");
    expect(result.current.input).toBe("");
  });
});

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
