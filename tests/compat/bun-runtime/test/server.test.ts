import { afterAll, describe, expect, it } from "bun:test";
import type { ClientStream, ClientStreamEvent, ClientStreamRequest } from "@anvia/client";
import { createHttpClientTransport, parseClientStreamRequest } from "@anvia/client";
import {
  EventStreamHttpError,
  fetchEventStream,
  readJsonlStream,
  readSseStream,
} from "@anvia/client/transport";
import {
  type ClientResumableEvent,
  type ResumableStreamEnvelope,
  createClientStreamResponse,
  createEventStreamResponse,
  createMemoryResumableStreamStore,
  resumeClientStreamResponse,
} from "@anvia/server";

type GenericEvent = { kind: string };

const requests: Array<{
  pathname: string;
  request: ClientStreamRequest;
  clientHeader: string | null;
}> = [];
const resumableStore = createMemoryResumableStreamStore<ClientResumableEvent>();
let observeCancellation: (() => void) | undefined;
const eventStore = createMemoryResumableStreamStore<GenericEvent>();
let releaseLiveProducer: (() => void) | undefined;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/cancel") {
      return createEventStreamResponse({
        events: cancellableEvents(() => observeCancellation?.()),
      });
    }

    if (url.pathname === "/http-error") {
      return new Response("upstream unavailable", { status: 503 });
    }

    if (url.pathname === "/resumable-error") {
      return createEventStreamResponse({
        events: failingEvents(),
        resumable: { id: "bun-error-stream", store: eventStore },
      });
    }

    const body = parseClientStreamRequest(await request.json());
    requests.push({
      pathname: url.pathname,
      request: body,
      clientHeader: request.headers.get("x-bun-client"),
    });

    if (url.pathname === "/resumable") {
      if (body.resume !== undefined) {
        return resumeClientStreamResponse({
          streamId: body.resume.streamId,
          after: body.resume.after,
          store: resumableStore,
        });
      }
      return createClientStreamResponse({
        events: clientEvents([
          { type: "run_start", runId: "resume-run", source: "completion" },
          { type: "run_end", runId: "resume-run", status: "completed" },
        ]),
        resumable: { streamId: "bun-resumable", store: resumableStore },
      });
    }

    if (url.pathname === "/resumable-live") {
      if (body.resume !== undefined) {
        return resumeClientStreamResponse({
          streamId: body.resume.streamId,
          after: body.resume.after,
          store: resumableStore,
        });
      }
      return createClientStreamResponse({
        events: liveEvents(),
        resumable: { streamId: "bun-live", store: resumableStore },
      });
    }

    const format = url.pathname === "/sse" ? "sse" : "jsonl";
    return createClientStreamResponse({
      events: clientEvents([
        { type: "run_start", runId: `${format}-run`, source: "completion" },
        { type: "run_end", runId: `${format}-run`, status: "completed" },
      ]),
      format,
      streamId: `bun-${format}`,
    });
  },
});

afterAll(() => {
  server.stop(true);
});

describe("@anvia/client and @anvia/server under Bun", () => {
  it("round-trips framed JSONL and SSE responses through Bun fetch", async () => {
    requests.length = 0;

    for (const format of ["jsonl", "sse"] as const) {
      const transport = createHttpClientTransport({
        endpoint: new URL(`/${format}`, server.url),
      });
      const frames = await collect(
        transport.send({
          request: { type: "messages", messages: [] },
          headers: { "x-bun-client": format },
        }),
      );

      expect(frames.map((frame) => frame.type)).toEqual([
        "stream_start",
        "stream_event",
        "stream_event",
        "stream_end",
      ]);
      expect(frames[0]).toMatchObject({
        protocol: "anvia.client.v3",
        streamId: `bun-${format}`,
        resumable: false,
      });
      expect(frames[2]).toMatchObject({
        event: { type: "run_end", runId: `${format}-run`, status: "completed" },
      });
    }

    expect(requests.map((request) => request.pathname)).toEqual(["/jsonl", "/sse"]);
    expect(requests.map((request) => request.clientHeader)).toEqual(["jsonl", "sse"]);
    expect(requests.every((request) => request.request.type === "messages")).toBe(true);
  });

  it("replays a resumable client stream from the requested event ID", async () => {
    const transport = createHttpClientTransport({
      endpoint: new URL("/resumable", server.url),
    });
    const initial = await collect(transport.send({ request: { type: "messages", messages: [] } }));
    expect(initial.at(-1)).toMatchObject({ type: "stream_end", eventId: 2 });

    const resume = { streamId: "bun-resumable", after: 1 };
    const resumed = await collect(
      transport.send({
        request: { type: "messages", messages: [], resume },
      }),
    );

    expect(resumed).toEqual([
      expect.objectContaining({
        type: "stream_start",
        streamId: "bun-resumable",
        resumable: true,
      }),
      expect.objectContaining({
        type: "stream_event",
        streamId: "bun-resumable",
        eventId: 2,
        event: { type: "run_end", runId: "resume-run", status: "completed" },
      }),
      { type: "stream_end", streamId: "bun-resumable", eventId: 2, status: "completed" },
    ]);
  });

  it("cancels the server iterator when a Bun fetch consumer disconnects", async () => {
    const cancelled = deferred<void>();
    observeCancellation = cancelled.resolve;
    const controller = new AbortController();
    const iterator = fetchEventStream<GenericEvent>({
      input: new URL("/cancel", server.url),
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    try {
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { kind: "first" },
      });
      const pending = iterator.next();
      controller.abort();

      await within(
        pending.then(
          () => undefined,
          () => undefined,
        ),
      );
      await within(cancelled.promise);
    } finally {
      controller.abort();
      await iterator.return?.();
      observeCancellation = undefined;
    }
  });

  it("decodes JSONL records split at every byte boundary", async () => {
    const text = '{"index":0,"text":"café"}\r\n{"index":1,"text":"naïve"}\r\n{"index":2}';

    const events = await collect(readJsonlStream<Record<string, unknown>>(byteStream(text)));

    expect(events).toEqual([{ index: 0, text: "café" }, { index: 1, text: "naïve" }, { index: 2 }]);
  });

  it("decodes SSE comments, multi-line data, and an unterminated final record", async () => {
    const text = [
      ": heartbeat",
      'data: {"index":0}',
      "",
      'data: {"items":["a",',
      'data: "b"]}',
      "",
      'data: {"index":2}',
    ].join("\r\n");

    const events = await collect(readSseStream<Record<string, unknown>>(byteStream(text)));

    expect(events).toEqual([{ index: 0 }, { items: ["a", "b"] }, { index: 2 }]);
  });

  it("surfaces EventStreamHttpError with status and body for non-OK responses", async () => {
    const failure = fetchEventStream<GenericEvent>({
      input: new URL("/http-error", server.url),
    })[Symbol.asyncIterator]();

    await expect(failure.next()).rejects.toBeInstanceOf(EventStreamHttpError);
    await failure.return?.();

    const probe = fetchEventStream<GenericEvent>({ input: new URL("/http-error", server.url) });
    const error = await probe[Symbol.asyncIterator]()
      .next()
      .catch((caught: unknown) => caught as EventStreamHttpError);
    expect(error).toBeInstanceOf(EventStreamHttpError);
    expect((error as EventStreamHttpError).response.status).toBe(503);
    expect((error as EventStreamHttpError).body).toBe("upstream unavailable");
  });

  it("reports a missing resumable stream with an empty replay", async () => {
    const transport = createHttpClientTransport({
      endpoint: new URL("/resumable", server.url),
    });
    const frames = await collect(
      transport.send({
        request: { type: "messages", messages: [], resume: { streamId: "bun-missing", after: 0 } },
      }),
    );

    expect(frames.map((frame) => frame.type)).toEqual(["stream_start", "stream_end"]);
    expect(frames[0]).toMatchObject({ streamId: "bun-missing", resumable: true });
    expect(frames[1]).toMatchObject({ streamId: "bun-missing", eventId: 0, status: "missing" });
  });

  it("appends an error event and closes the resumable stream when the producer throws", async () => {
    const events = await collect(
      fetchEventStream<ResumableStreamEnvelope<GenericEvent>>({
        input: new URL("/resumable-error", server.url),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "stream_start",
      "stream_event",
      "stream_event",
      "stream_end",
    ]);
    expect(events[2]).toMatchObject({
      eventId: 2,
      event: { type: "error", error: { name: "Error", message: "producer failed" } },
    });
    expect(events[3]).toMatchObject({ streamId: "bun-error-stream", eventId: 2, status: "error" });
  });

  it("replays into a live resumable stream after a mid-stream disconnect", async () => {
    const first = createHttpClientTransport({ endpoint: new URL("/resumable-live", server.url) });
    const firstIterator = first
      .send({ request: { type: "messages", messages: [] } })
      [Symbol.asyncIterator]();

    try {
      await firstIterator.next();
      await firstIterator.next();
      await firstIterator.return?.();

      const resumed = createHttpClientTransport({
        endpoint: new URL("/resumable-live", server.url),
      });
      const resumedPromise = collect(
        resumed.send({
          request: { type: "messages", messages: [], resume: { streamId: "bun-live", after: 1 } },
        }),
      );
      releaseLiveProducer?.();

      const frames = await resumedPromise;
      expect(frames.map((frame) => frame.type)).toEqual([
        "stream_start",
        "stream_event",
        "stream_end",
      ]);
      expect(frames[1]).toMatchObject({
        eventId: 2,
        event: { type: "run_end", runId: "live-run", status: "completed" },
      });
      expect(frames[2]).toMatchObject({ streamId: "bun-live", eventId: 2, status: "completed" });
    } finally {
      releaseLiveProducer?.();
      await firstIterator.return?.();
      releaseLiveProducer = undefined;
    }
  });
});

function byteStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + 1));
      offset += 1;
    },
  });
}

function failingEvents(): AsyncIterable<GenericEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { kind: "first" };
      throw new Error("producer failed");
    },
  };
}

function liveEvents(): ClientStream {
  return {
    async *[Symbol.asyncIterator]() {
      const start: ClientStreamEvent = {
        type: "run_start",
        runId: "live-run",
        source: "completion",
      };
      const end: ClientStreamEvent = { type: "run_end", runId: "live-run", status: "completed" };
      yield start;
      await new Promise<void>((resolve) => {
        releaseLiveProducer = resolve;
      });
      yield end;
    },
  };
}

function clientEvents(events: readonly ClientStreamEvent[]): ClientStream {
  return values(events);
}

function values<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function cancellableEvents(onCancel: () => void): AsyncIterable<GenericEvent> {
  return {
    [Symbol.asyncIterator]() {
      let emitted = false;
      let finish: ((result: IteratorResult<GenericEvent>) => void) | undefined;
      return {
        next() {
          if (!emitted) {
            emitted = true;
            return Promise.resolve({ done: false as const, value: { kind: "first" } });
          }
          return new Promise<IteratorResult<GenericEvent>>((resolve) => {
            finish = resolve;
          });
        },
        return() {
          onCancel();
          finish?.({ done: true, value: undefined });
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

async function within<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for stream cleanup")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
