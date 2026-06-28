import { AssistantContent, type CompletionStreamEvent, Usage } from "@anvia/core/completion";
import type { UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventTransport, UseCompletionRequestArgs } from "../src";
import { useCompletion } from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("@anvia/react useCompletion", () => {
  it("streams into UI messages and derives completion text", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* (request) {
        expect(request.messages).toMatchObject([
          { role: "user", content: [{ type: "text", text: "hello" }] },
        ]);
        expect(request.stream).toBe(true);
        yield { type: "message_id", id: "provider_1" };
        yield {
          type: "text_delta",
          delta: "Hel",
        };
        yield {
          type: "text_delta",
          delta: "lo",
        };
        yield {
          type: "final",
          response: {
            choice: [AssistantContent.text("Hello")],
            usage: Usage.empty(),
            rawResponse: {},
          },
        };
      },
    };

    const { result } = renderHook(() => useCompletion({ transport, onEvent }));

    await act(async () => {
      await result.current.complete("hello");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.completion).toBe("Hello");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  it("creates endpoint-backed transports with the standardized request shape", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          streamFrom(
            `${[
              '{"type":"text_delta","delta":"hi"}',
              '{"type":"final","response":{"choice":[{"type":"text","text":"hi"}],"usage":{"inputTokens":0,"outputTokens":0,"totalTokens":0,"cachedInputTokens":0,"cacheCreationInputTokens":0},"rawResponse":{}}}',
            ].join("\n")}\n`,
          ),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useCompletion({ endpoint: "https://example.test/completion" }),
    );

    await act(async () => {
      await result.current.complete("hello");
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      stream: true,
    });
    expect(result.current.completion).toBe("hi");
  });

  it("passes core and UI messages to custom completion request factories", async () => {
    type CustomRequest = {
      messages: unknown[];
      uiMessages: unknown[];
      stream: true;
    };
    const createRequest = vi.fn((args: UseCompletionRequestArgs) => ({
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

    const { result } = renderHook(() => useCompletion<CustomRequest>({ transport, createRequest }));

    await act(async () => {
      await result.current.complete("hello");
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

  it("keeps streamed text when the raw completion final choice is empty", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield { type: "text_delta", delta: "Hai" };
        yield {
          type: "final",
          response: {
            choice: [],
            usage: Usage.empty(),
            rawResponse: {},
            messageId: "provider_1",
          },
        };
      },
    };

    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("hey");
    });

    expect(result.current.completion).toBe("Hai");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "hey" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hai" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
  });

  it("does not add empty text for reasoning-only raw completion finals", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield { type: "reasoning_delta", delta: "Think first." };
        yield {
          type: "final",
          response: {
            choice: [],
            usage: Usage.empty(),
            rawResponse: {},
            messageId: "provider_1",
          },
        };
      },
    };

    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("hey");
    });

    expect(result.current.completion).toBe("");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "hey" }] },
      {
        role: "assistant",
        parts: [{ type: "reasoning", text: "Think first." }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
  });

  it("supports custom event mapping for non-UI streams", async () => {
    const transport: EventTransport<UIStreamRequest, { type: string; delta?: string }> = {
      send: async function* () {
        yield { type: "token", delta: "one" };
        yield { type: "token", delta: " two" };
      },
    };

    const { result } = renderHook(() =>
      useCompletion({
        transport,
        eventToDelta: (event) => (event.type === "token" ? event.delta : undefined),
      }),
    );

    await act(async () => {
      await result.current.complete("hi");
    });

    expect(result.current.completion).toBe("one two");
  });

  it("lets custom delta mapping override raw Anvia event names", async () => {
    const transport: EventTransport<UIStreamRequest, { type: "text_delta"; delta: string }> = {
      send: async function* () {
        yield { type: "text_delta", delta: "raw" };
      },
    };

    const { result } = renderHook(() =>
      useCompletion({
        transport,
        eventToDelta: (event) => (event.type === "text_delta" ? "custom" : undefined),
      }),
    );

    await act(async () => {
      await result.current.complete("hi");
    });

    expect(result.current.completion).toBe("custom");
  });

  it("does not send empty input", async () => {
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: vi.fn(async function* (): AsyncIterable<UIStreamEvent> {
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
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

  it("handles errors and reset", async () => {
    const error = new Error("failed");
    const onError = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
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

  it("aborts active streams when stopped", async () => {
    let signal: AbortSignal | undefined;
    let completePromise!: Promise<void>;
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

  it("supports controlled input", async () => {
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* () {
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
        yield {
          type: "text_delta",
          messageId: "assistant_1",
          partId: "assistant_1_text",
          delta: "ok",
        };
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

function failingEvents(error: unknown): AsyncIterable<UIStreamEvent> {
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

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
