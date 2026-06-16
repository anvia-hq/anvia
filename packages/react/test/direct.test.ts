import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDirectTransport, useChat, useCompletion } from "../src";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@anvia/react createDirectTransport", () => {
  it("yields events from the handler", async () => {
    const transport = createDirectTransport<{ prompt: string }, { type: string; value: number }>(
      async function* () {
        yield { type: "one", value: 1 };
        yield { type: "two", value: 2 };
      },
    );

    const events = await collect(transport.send({ prompt: "hi" }));
    expect(events).toEqual([
      { type: "one", value: 1 },
      { type: "two", value: 2 },
    ]);
  });

  it("passes the request to the handler", async () => {
    const handler = vi.fn(async function* () {
      yield { type: "ok" };
    });
    const transport = createDirectTransport<{ message: string }, { type: string }>(handler);

    await collect(transport.send({ message: "test" }));
    expect(handler).toHaveBeenCalledWith({ message: "test" });
  });

  it("supports abort signal", async () => {
    const controller = new AbortController();
    const transport = createDirectTransport<unknown, { type: string }>(async function* () {
      while (true) {
        yield { type: "item" };
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    const events: { type: string }[] = [];
    const iterable = transport.send({}, { signal: controller.signal });
    const iterator = iterable[Symbol.asyncIterator]();

    const first = await iterator.next();
    events.push(first.value);
    controller.abort();
    const second = await iterator.next();
    expect(second.done).toBe(true);
    expect(events).toEqual([{ type: "item" }]);
  });

  it("calls return on the iterator when done", async () => {
    let returned = false;
    const transport = createDirectTransport<unknown, { type: string }>(() => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true, value: undefined };
          },
          async return() {
            returned = true;
            return { done: true, value: undefined };
          },
        };
      },
    }));

    await collect(transport.send({}));
    expect(returned).toBe(true);
  });

  it("works with useCompletion", async () => {
    const transport = createDirectTransport<
      { prompt: string; stream: true },
      { type: string; delta?: string; response?: { choice: { type: string; text: string }[] } }
    >(async function* (request) {
      expect(request.prompt).toBe("hello");
      yield { type: "text_delta", delta: "world" };
      yield {
        type: "final",
        response: { choice: [{ type: "text", text: "world" }] },
      };
    });

    const { result } = renderHook(() => useCompletion({ transport }));

    await act(async () => {
      await result.current.complete("hello");
    });

    expect(result.current.completion).toBe("world");
    expect(result.current.status).toBe("idle");
  });

  it("works with useChat", async () => {
    const transport = createDirectTransport<
      { message: string; history: unknown[]; stream: true },
      { type: string; delta?: string; output?: string }
    >(async function* (request) {
      expect(request.message).toBe("hi");
      yield { type: "text_delta", delta: "Hey" };
      yield { type: "final", output: "Hey there" };
    });

    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("Hey there");
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
