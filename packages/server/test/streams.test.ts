import { describe, expect, it } from "vitest";

import { createEventStream, createJsonlStream, createSseStream } from "../src";

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
