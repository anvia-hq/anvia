// @vitest-environment happy-dom
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientStream,
  type ClientStreamEvent,
  type ClientStreamRequest,
  createDirectClientTransport,
} from "@anvia/client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as publicReact from "../src";
import { useChat, useCompletion } from "../src";

describe("public boundary", () => {
  it("does not re-export client protocol or transport ownership", () => {
    expect(publicReact).not.toHaveProperty("createHttpClientTransport");
    expect(publicReact).not.toHaveProperty("createDirectClientTransport");
    expect(publicReact).not.toHaveProperty("parseClientStreamEvent");
    expect(publicReact).not.toHaveProperty("fetchEventStream");
  });
});

describe("useChat", () => {
  it("sends core messages and reduces the canonical framed stream", async () => {
    const requests: ClientStreamRequest[] = [];
    const transport = createDirectClientTransport((request: ClientStreamRequest) => {
      requests.push(request);
      return events([
        { type: "run_start", runId: "run_1", source: "completion" },
        {
          type: "message_start",
          runId: "run_1",
          messageId: "assistant_1",
          role: "assistant",
        },
        {
          type: "text_start",
          runId: "run_1",
          messageId: "assistant_1",
          partId: "text_1",
        },
        {
          type: "text_delta",
          runId: "run_1",
          messageId: "assistant_1",
          partId: "text_1",
          delta: "Hello",
        },
        {
          type: "text_end",
          runId: "run_1",
          messageId: "assistant_1",
          partId: "text_1",
          text: "Hello!",
        },
        { type: "run_end", runId: "run_1", status: "completed", text: "Hello!" },
      ]);
    });
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => result.current.sendMessage("Hi"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    expect("stream" in (requests[0] as unknown as Record<string, unknown>)).toBe(false);
    expect(result.current.text).toBe("Hello!");
    expect(result.current.status).toBe("ready");
    expect(result.current.events).toHaveLength(6);
  });

  it("uses submitted, streaming, and error as distinct states", async () => {
    let releaseStart: (() => void) | undefined;
    let releaseEnd: (() => void) | undefined;
    const transport = {
      async *send() {
        yield {
          type: "stream_start" as const,
          protocol: CLIENT_STREAM_PROTOCOL,
          streamId: "stream_1",
          eventId: 0 as const,
          resumable: false,
        };
        await new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        yield {
          type: "stream_event" as const,
          streamId: "stream_1",
          eventId: 1,
          event: { type: "run_start" as const, runId: "run_1", source: "completion" as const },
        };
        await new Promise<void>((resolve) => {
          releaseEnd = resolve;
        });
        yield {
          type: "stream_event" as const,
          streamId: "stream_1",
          eventId: 2,
          event: {
            type: "error" as const,
            runId: "run_1",
            error: { message: "Safe failure" },
          },
        };
        yield {
          type: "stream_end" as const,
          streamId: "stream_1",
          eventId: 2,
          status: "completed" as const,
        };
      },
    };
    const onError = vi.fn();
    const { result } = renderHook(() => useChat({ transport, onError }));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.sendMessage("Hi");
    });
    await waitFor(() => expect(result.current.status).toBe("submitted"));
    act(() => releaseStart?.());
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    act(() => releaseEnd?.());
    await act(async () => pending);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("Safe failure");
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("useCompletion", () => {
  it("is a prompt-oriented view over the same client protocol", async () => {
    const transport = createDirectClientTransport((_request: ClientStreamRequest) =>
      events([
        { type: "run_start", runId: "run_1", source: "completion" },
        {
          type: "text_delta",
          runId: "run_1",
          messageId: "assistant_1",
          partId: "text_1",
          delta: "Done",
        },
        { type: "run_end", runId: "run_1", status: "completed", text: "Done" },
      ]),
    );
    const { result } = renderHook(() => useCompletion({ transport }));
    act(() => result.current.setInput("Write"));
    await act(async () => result.current.complete());
    expect(result.current.input).toBe("");
    expect(result.current.completion).toBe("Done");
    expect(result.current.status).toBe("ready");
  });
});

function events(values: ClientStreamEvent[]): ClientStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}
