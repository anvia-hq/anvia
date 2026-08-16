import type { ClientStream, ClientStreamEvent, ClientStreamFrame } from "@anvia/client";
import { describe, expect, it } from "vitest";
import * as publicServer from "../src";
import {
  type ClientResumableEvent,
  createClientStreamResponse,
  createEventStreamResponse,
  createJsonlStream,
  createMemoryResumableStreamStore,
  resumeClientStreamResponse,
  resumeEventStreamResponse,
} from "../src";

function CompileServerBoundary() {
  const events = values([{ kind: "event" }]);
  // @ts-expect-error Server response helpers accept one options object.
  createEventStreamResponse(events);
  // @ts-expect-error Low-level stream helpers accept one options object.
  createJsonlStream(events);
}
void CompileServerBoundary;

describe("public boundary", () => {
  it("does not retain ambiguous response aliases", () => {
    expect(publicServer).not.toHaveProperty("createEventStream");
    expect(publicServer).not.toHaveProperty("createUIStreamResponse");
    expect(publicServer).not.toHaveProperty("resumeEventStream");
  });
});

describe("generic event responses", () => {
  it("encodes JSONL without pretending generic events are client messages", async () => {
    const response = createEventStreamResponse({
      events: values([{ kind: "one" }, { kind: "two" }]),
    });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await jsonl(response)).toEqual([{ kind: "one" }, { kind: "two" }]);
  });

  it("uses a separate explicit resume function", async () => {
    const store = createMemoryResumableStreamStore<{ kind: string }>();
    const initial = createEventStreamResponse({
      events: values([{ kind: "one" }, { kind: "two" }]),
      resumable: { id: "generic_1", store },
    });
    await initial.text();
    const resumed = resumeEventStreamResponse({
      streamId: "generic_1",
      after: 1,
      store,
    });
    expect(await jsonl(resumed)).toEqual([
      { type: "stream_start", streamId: "generic_1", eventId: 0 },
      { type: "stream_event", streamId: "generic_1", eventId: 2, event: { kind: "two" } },
      { type: "stream_end", streamId: "generic_1", eventId: 2, status: "completed" },
    ]);
  });
});

describe("client stream responses", () => {
  it("always emits protocol frames and the protocol response header", async () => {
    const response = createClientStreamResponse({
      events: clientEvents([
        { type: "run_start", runId: "run_1", source: "completion" },
        { type: "run_end", runId: "run_1", status: "completed", text: "Done" },
      ]),
      streamId: "stream_1",
    });
    expect(response.headers.get("x-anvia-stream-protocol")).toBe("anvia.client.v2");
    const frames = (await jsonl(response)) as ClientStreamFrame[];
    expect(frames.map((frame) => frame.type)).toEqual([
      "stream_start",
      "stream_event",
      "stream_event",
      "stream_end",
    ]);
    expect(frames[0]).toMatchObject({
      protocol: "anvia.client.v2",
      streamId: "stream_1",
      resumable: false,
    });
  });

  it("does not serialize a thrown server error", async () => {
    const response = createClientStreamResponse({
      events: failingClientStream(new Error("database secret")),
      streamId: "stream_1",
    });
    const body = await response.text();
    expect(body).not.toContain("database secret");
    expect(body).not.toContain("Error");
    expect(
      body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual([
      {
        type: "stream_start",
        protocol: "anvia.client.v2",
        streamId: "stream_1",
        eventId: 0,
        resumable: false,
      },
      { type: "stream_end", streamId: "stream_1", eventId: 0, status: "error" },
    ]);
  });

  it("persists canonical events and resumes with original event IDs", async () => {
    const store = createMemoryResumableStreamStore<ClientResumableEvent>();
    const initial = createClientStreamResponse({
      events: clientEvents([
        { type: "run_start", runId: "run_1", source: "completion" },
        {
          type: "memory_compaction",
          runId: "run_1",
          originalMessageCount: 12,
          compactedMessageCount: 8,
          retainedMessageCount: 4,
          attempts: 1,
          usage: {
            inputTokens: 20,
            outputTokens: 5,
            totalTokens: 25,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
        { type: "run_end", runId: "run_1", status: "completed" },
      ]),
      resumable: { streamId: "stream_1", store },
    });
    await initial.text();

    const resumed = resumeClientStreamResponse({ streamId: "stream_1", after: 1, store });
    const frames = (await jsonl(resumed)) as ClientStreamFrame[];
    expect(frames[0]).toMatchObject({ type: "stream_start", resumable: true });
    expect(frames[1]).toMatchObject({
      type: "stream_event",
      eventId: 2,
      event: { type: "memory_compaction", compactedMessageCount: 8 },
    });
    expect(frames[2]).toMatchObject({ type: "stream_event", eventId: 3 });
    expect(frames[3]).toEqual({
      type: "stream_end",
      streamId: "stream_1",
      eventId: 3,
      status: "completed",
    });
  });

  it("supports SSE while preserving the exact same frames", async () => {
    const response = createClientStreamResponse({
      events: clientEvents([{ type: "run_end", runId: "run_1", status: "completed" }]),
      streamId: "stream_1",
      format: "sse",
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"protocol":"anvia.client.v2"');
    expect(text).toContain('"type":"stream_end"');
  });

  it("rejects v1 resumable client records instead of replaying them as v2", async () => {
    const store = createMemoryResumableStreamStore<ClientResumableEvent>();
    await store.open({ streamId: "stream_v1" });
    await store.append({
      streamId: "stream_v1",
      event: {
        protocol: "anvia.client.v1",
        event: { type: "run_start", runId: "run_1", source: "completion" },
      } as unknown as ClientResumableEvent,
    });
    await store.close({ streamId: "stream_v1", status: "completed" });

    const frames = (await jsonl(
      resumeClientStreamResponse({ streamId: "stream_v1", after: 0, store }),
    )) as ClientStreamFrame[];
    expect(frames).toEqual([
      expect.objectContaining({ type: "stream_start", protocol: "anvia.client.v2" }),
      { type: "stream_end", streamId: "stream_v1", eventId: 1, status: "error" },
    ]);
  });
});

function values<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function clientEvents(items: ClientStreamEvent[]): ClientStream {
  return values(items);
}

function failingClientStream(error: unknown): ClientStream {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<ClientStreamEvent>> {
          throw error;
        },
      };
    },
  };
}

async function jsonl(response: Response): Promise<unknown[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}
