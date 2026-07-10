import { describe, expect, it } from "vitest";

import {
  createEventStream,
  createJsonlStream,
  createMemoryResumableStreamStore,
  createResumableStream,
  createSseStream,
  createUIStreamResponse,
  resumeStreamEvents,
} from "../src";

describe("@anvia/server streams", () => {
  it("serializes async iterables as jsonl", async () => {
    const text = await readText(createJsonlStream(events([{ type: "one" }, { type: "two" }])));

    expect(text).toBe('{"type":"one"}\n{"type":"two"}\n');
  });

  it("serializes async iterables as server-sent events", async () => {
    const text = await readText(
      createSseStream(events([{ type: "one", value: "hello\nworld" }]), {
        eventName: (event) => event.type,
      }),
    );

    expect(text).toBe('event: one\ndata: {"type":"one","value":"hello\\nworld"}\n\n');
  });

  it("creates event stream responses with default jsonl headers", async () => {
    const response = createEventStream(events([{ type: "one" }]));

    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe('{"type":"one"}\n');
  });

  it("streams event responses before the upstream iterable completes", async () => {
    let releaseSecondEvent!: () => void;
    const secondEventReady = new Promise<void>((resolve) => {
      releaseSecondEvent = resolve;
    });
    const response = createEventStream(
      (async function* () {
        yield { type: "one" };
        await secondEventReady;
        yield { type: "two" };
      })(),
    );
    if (response.body === null) {
      throw new Error("Expected event stream response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();

    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe('{"type":"one"}\n');

    releaseSecondEvent();
    const second = await reader.read();

    expect(second.done).toBe(false);
    expect(decoder.decode(second.value)).toBe('{"type":"two"}\n');
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("creates event stream responses with custom response init", async () => {
    const response = createEventStream(events([{ type: "one" }]), {
      headers: {
        "cache-control": "private",
        "content-type": "application/custom",
        "x-custom": "yes",
      },
      status: 202,
      statusText: "Accepted",
    });

    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("cache-control")).toBe("private");
    expect(response.headers.get("content-type")).toBe("application/custom");
    expect(response.headers.get("x-custom")).toBe("yes");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("creates event stream responses with sse headers", async () => {
    const response = createEventStream(events([{ type: "one" }]), { format: "sse" });

    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(await response.text()).toBe('data: {"type":"one"}\n\n');
  });

  it("creates resumable event stream responses", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    const response = createEventStream(events([{ type: "one" }, { type: "two" }]), {
      resumable: {
        id: "run_1",
        store,
      },
    });

    const parsed = parseJsonl(await response.text());

    expect(parsed).toEqual([
      { type: "stream_start", streamId: "run_1", eventId: 0 },
      { type: "stream_event", streamId: "run_1", eventId: 1, event: { type: "one" } },
      { type: "stream_event", streamId: "run_1", eventId: 2, event: { type: "two" } },
      { type: "stream_end", streamId: "run_1", eventId: 2, status: "completed" },
    ]);
    await expect(store.status({ streamId: "run_1" })).resolves.toMatchObject({
      status: "completed",
      lastEventId: 2,
    });
  });

  it("resumes stored events and tails live resumable stream events", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    await store.open({ streamId: "run_1" });
    await store.append({ streamId: "run_1", event: { type: "one" } });

    const iterator = resumeStreamEvents({
      id: "run_1",
      after: 0,
      store,
    })[Symbol.asyncIterator]();

    await expect(nextValue(iterator)).resolves.toEqual({
      type: "stream_start",
      streamId: "run_1",
      eventId: 0,
    });
    await expect(nextValue(iterator)).resolves.toEqual({
      type: "stream_event",
      streamId: "run_1",
      eventId: 1,
      event: { type: "one" },
    });

    const nextEvent = nextValue(iterator);
    await store.append({ streamId: "run_1", event: { type: "two" } });
    await expect(nextEvent).resolves.toEqual({
      type: "stream_event",
      streamId: "run_1",
      eventId: 2,
      event: { type: "two" },
    });

    const endEvent = nextValue(iterator);
    await store.close({ streamId: "run_1", status: "completed" });
    await expect(endEvent).resolves.toEqual({
      type: "stream_end",
      streamId: "run_1",
      eventId: 2,
      status: "completed",
    });
  });

  it("stores and emits resumable stream errors", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    const response = createEventStream(failingEvents<{ type: string }>(new Error("nope")), {
      resumable: {
        id: "run_1",
        store,
      },
    });

    const parsed = parseJsonl(await response.text());

    expect(parsed).toMatchObject([
      { type: "stream_start", streamId: "run_1", eventId: 0 },
      {
        type: "stream_event",
        streamId: "run_1",
        eventId: 1,
        event: { type: "error", error: { name: "Error", message: "nope" } },
      },
      { type: "stream_end", streamId: "run_1", eventId: 1, status: "error" },
    ]);
  });

  it("keeps storing resumable events after response cancellation", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    let continueEvents!: () => void;
    const response = createEventStream(
      (async function* () {
        yield { type: "one" };
        await new Promise<void>((resolve) => {
          continueEvents = resolve;
        });
        yield { type: "two" };
      })(),
      {
        resumable: {
          id: "run_1",
          store,
        },
      },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("Expected response body");
    }

    await reader.read();
    await reader.read();
    await reader.cancel();
    continueEvents();

    await waitFor(async () => {
      const state = await store.status({ streamId: "run_1" });
      return state.status === "completed" && state.lastEventId === 2;
    });
  });

  it("enforces resumable store lifecycle boundaries", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();

    await expect(store.status({ streamId: "missing" })).resolves.toEqual({
      status: "missing",
      lastEventId: 0,
    });
    await expect(store.append({ streamId: "missing", event: { type: "one" } })).rejects.toThrow(
      'Resumable stream "missing" is not open',
    );
    await expect(store.close({ streamId: "missing", status: "error" })).resolves.toEqual({
      status: "error",
      lastEventId: 0,
    });

    await store.open({ streamId: "run_1" });
    await store.append({ streamId: "run_1", event: { type: "one" } });
    await store.close({ streamId: "run_1", status: "completed" });

    await expect(store.append({ streamId: "run_1", event: { type: "two" } })).rejects.toThrow(
      'Resumable stream "run_1" is already completed',
    );
  });

  it("honors resume cursors for stored events and concurrent subscribers", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    await store.open({ streamId: "run_1" });
    await store.append({ streamId: "run_1", event: { type: "one" } });

    const first = store.subscribe({ streamId: "run_1", after: 1 })[Symbol.asyncIterator]();
    const second = store.subscribe({ streamId: "run_1", after: 0 })[Symbol.asyncIterator]();
    await expect(nextValue(second)).resolves.toMatchObject({
      streamId: "run_1",
      eventId: 1,
      event: { type: "one" },
    });

    const firstLive = nextValue(first);
    const secondLive = nextValue(second);
    await store.append({ streamId: "run_1", event: { type: "two" } });

    const expected = {
      streamId: "run_1",
      eventId: 2,
      event: { type: "two" },
    };
    await expect(firstLive).resolves.toMatchObject(expected);
    await expect(secondLive).resolves.toMatchObject(expected);

    await first.return?.();
    const secondEnd = second.next();
    await store.close({ streamId: "run_1", status: "completed" });
    await expect(secondEnd).resolves.toEqual({ value: undefined, done: true });
  });

  it("reopening a stream resets records and closes existing subscribers", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    await store.open({ streamId: "run_1" });
    await store.append({ streamId: "run_1", event: { type: "old" } });
    const oldSubscriber = store.subscribe({ streamId: "run_1", after: 1 })[Symbol.asyncIterator]();
    const oldNext = oldSubscriber.next();

    await store.open({ streamId: "run_1" });
    await expect(oldNext).resolves.toEqual({ value: undefined, done: true });
    await expect(store.status({ streamId: "run_1" })).resolves.toEqual({
      status: "running",
      lastEventId: 0,
    });

    await expect(
      store.append({ streamId: "run_1", event: { type: "new" } }),
    ).resolves.toMatchObject({ eventId: 1, event: { type: "new" } });
  });

  it("drains a resumable source only once for multiple consumers", async () => {
    const store = createMemoryResumableStreamStore<{ type: string }>();
    let sourceStarts = 0;
    const stream = createResumableStream(
      (async function* () {
        sourceStarts += 1;
        yield { type: "one" };
        yield { type: "two" };
      })(),
      { id: "run_1", store },
    );

    const [first, second] = await Promise.all([collect(stream), collect(stream)]);

    expect(sourceStarts).toBe(1);
    expect(first).toEqual(second);
    expect(first).toEqual([
      { type: "stream_start", streamId: "run_1", eventId: 0 },
      { type: "stream_event", streamId: "run_1", eventId: 1, event: { type: "one" } },
      { type: "stream_event", streamId: "run_1", eventId: 2, event: { type: "two" } },
      { type: "stream_end", streamId: "run_1", eventId: 2, status: "completed" },
    ]);
  });

  it("creates UI stream responses with text deltas", async () => {
    const response = createUIStreamResponse(
      events([
        {
          type: "text_delta",
          messageId: "msg_1",
          partId: "part_1",
          delta: "Hello",
        },
      ]),
    );

    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(await response.text()).toBe(
      '{"type":"text_delta","messageId":"msg_1","partId":"part_1","delta":"Hello"}\n',
    );
  });

  it("supports custom jsonl serializers", async () => {
    const text = await readText(
      createJsonlStream(events([{ type: "one" }]), {
        serialize: (event) => `custom:${"type" in event ? event.type : "unknown"}`,
      }),
    );

    expect(text).toBe("custom:one\n");
  });

  it("supports sse retry and custom serializers", async () => {
    const text = await readText(
      createSseStream(events([{ type: "one", value: "hello\nworld" }]), {
        retry: 1500,
        eventName: "message",
        serialize: (event) => JSON.stringify(event, null, 2),
      }),
    );

    expect(text).toBe(
      'retry: 1500\n\nevent: message\ndata: {\ndata:   "type": "one",\ndata:   "value": "hello\\nworld"\ndata: }\n\n',
    );
  });

  it("rejects invalid sse retry values and event names", () => {
    expect(() => createSseStream(events([{ type: "one" }]), { retry: -1 })).toThrow(
      "SSE retry must be a finite non-negative integer",
    );
    expect(() => createSseStream(events([{ type: "one" }]), { retry: 1.5 })).toThrow(
      "SSE retry must be a finite non-negative integer",
    );
    expect(() =>
      createSseStream(events([{ type: "one" }]), {
        eventName: "bad\nevent",
      }),
    ).toThrow("SSE event names must not contain null bytes or line breaks");
  });

  it("emits an error event when iteration fails", async () => {
    const text = await readText(
      createJsonlStream(
        (async function* () {
          yield { type: "one" };
          throw new Error("stream failed");
        })(),
      ),
    );

    expect(text).toContain('{"type":"one"}\n');
    expect(text).toContain('"type":"error"');
    expect(text).toContain('"message":"stream failed"');
    expect(text).not.toContain('"stack"');
  });

  it("serializes non-error thrown values in error events", async () => {
    const text = await readText(
      createSseStream<{ type: string }>(failingEvents("plain failure"), {
        eventName: (event) => event.type,
      }),
    );

    expect(text).toBe('event: error\ndata: {"type":"error","error":"plain failure"}\n\n');
  });

  it.each(["jsonl", "sse"] as const)("cancels %s async iterators", async (format) => {
    let canceled = false;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false, value: { type: "one" } };
          },
          async return() {
            canceled = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const stream = format === "jsonl" ? createJsonlStream(source) : createSseStream(source);

    await stream.cancel();

    expect(canceled).toBe(true);
  });
});

async function* events<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function parseJsonl(text: string): unknown[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function nextValue<T>(iterator: AsyncIterator<T>): Promise<T> {
  const next = await iterator.next();
  if (next.done === true) {
    throw new Error("Expected iterator value");
  }
  return next.value;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for condition");
}

function failingEvents<TEvent = unknown>(error: unknown): AsyncIterable<TEvent> {
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
