import { describe, expect, it } from "vitest";

import {
  createEventStream,
  createJsonlStream,
  createMemoryResumableStreamStore,
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
    expect(await response.text()).toBe('{"type":"one"}\n');
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

  it("creates UI stream responses", async () => {
    const response = createUIStreamResponse(
      events([
        {
          type: "message_start",
          message: { id: "msg_1", role: "assistant", parts: [] },
        },
      ]),
    );

    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(await response.text()).toBe(
      '{"type":"message_start","message":{"id":"msg_1","role":"assistant","parts":[]}}\n',
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

  it("cancels async iterators", async () => {
    let canceled = false;
    const stream = createJsonlStream({
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
    });

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
