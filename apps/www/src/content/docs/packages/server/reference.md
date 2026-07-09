---
title: "Server"
description: "HTTP stream helpers from @anvia/server."
section: packages
sidebar:
  group: "server"
  order: 6
  label: "Server"
---
Import from `@anvia/server`.

## Types

```ts
type EventStreamFormat = "jsonl" | "sse";

type EventStreamErrorEvent = {
  type: "error";
  error: unknown;
};

type CreateEventStreamOptions<TEvent> = {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  resumable?: CreateResumableStreamOptions<TEvent>;
  jsonl?: JsonlStreamOptions<TEvent>;
  sse?: SseStreamOptions<TEvent>;
};

type JsonlStreamOptions<TEvent> = {
  serialize?: (event: TEvent | EventStreamErrorEvent) => string;
};

type SseStreamOptions<TEvent> = {
  eventName?: string | ((event: TEvent | EventStreamErrorEvent) => string | undefined);
  serialize?: (event: TEvent | EventStreamErrorEvent) => string;
  retry?: number;
};

type ResumableStreamFinalStatus = "completed" | "error";
type ResumableStreamStatus = "running" | ResumableStreamFinalStatus | "missing";

type ResumableStreamState = {
  status: ResumableStreamStatus;
  lastEventId: number;
};

type ResumableStreamRecord<TEvent> = {
  streamId: string;
  eventId: number;
  event: TEvent | EventStreamErrorEvent;
  createdAt?: Date;
};

type ResumableStreamEnvelope<TEvent> =
  | { type: "stream_start"; streamId: string; eventId: 0 }
  | { type: "stream_event"; streamId: string; eventId: number; event: TEvent | EventStreamErrorEvent }
  | { type: "stream_end"; streamId: string; eventId: number; status: ResumableStreamStatus };

type CreateResumableStreamOptions<TEvent> = {
  id: string;
  store: ResumableStreamStore<TEvent>;
};

type ResumeStreamEventsOptions<TEvent> = {
  id: string;
  after?: number;
  store: ResumableStreamStore<TEvent>;
};

type ResumableStreamOpenInput = { streamId: string };
type ResumableStreamAppendInput<TEvent> = {
  streamId: string;
  event: TEvent | EventStreamErrorEvent;
};
type ResumableStreamSubscribeInput = { streamId: string; after?: number };
type ResumableStreamStatusInput = { streamId: string };
type ResumableStreamCloseInput = { streamId: string; status: ResumableStreamFinalStatus };

interface ResumableStreamStore<TEvent = unknown> {
  open(input: ResumableStreamOpenInput): Promise<ResumableStreamState>;
  append(input: ResumableStreamAppendInput<TEvent>): Promise<ResumableStreamRecord<TEvent>>;
  subscribe(input: ResumableStreamSubscribeInput): AsyncIterable<ResumableStreamRecord<TEvent>>;
  status(input: ResumableStreamStatusInput): Promise<ResumableStreamState>;
  close(input: ResumableStreamCloseInput): Promise<ResumableStreamState>;
}
```

## createEventStream

```ts
function createEventStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options?: {
    format?: "jsonl" | "sse";
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
    resumable?: CreateResumableStreamOptions<TEvent>;
    jsonl?: JsonlStreamOptions<TEvent>;
    sse?: SseStreamOptions<TEvent>;
  },
): Response;
```

Purpose: convert an async iterable of events into an HTTP `Response`.

Default behavior: writes JSONL with `content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, and `x-accel-buffering: no`.

Use `format: "sse"` to emit `text/event-stream`.

Pass `resumable: { id, store }` to wrap events in `stream_start`, `stream_event`, and
`stream_end` envelopes and persist ordered events for later replay.

## createResumableStream

```ts
function createResumableStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: CreateResumableStreamOptions<TEvent>,
): AsyncIterable<ResumableStreamEnvelope<TEvent>>;
```

Purpose: wrap an event iterable in resumable envelopes and persist events to a
`ResumableStreamStore`.

## resumeStreamEvents

```ts
function resumeStreamEvents<TEvent>(
  options: ResumeStreamEventsOptions<TEvent>,
): AsyncIterable<ResumableStreamEnvelope<TEvent>>;
```

Purpose: replay stored events after `after`, then tail live events until the stream closes.

Use it from the same route that starts a stream:

```ts
if (body.resume !== undefined) {
  return createEventStream(
    resumeStreamEvents({
      id: body.resume.streamId,
      after: body.resume.after,
      store,
    }),
  );
}
```

## createMemoryResumableStreamStore

```ts
function createMemoryResumableStreamStore<TEvent = unknown>(): ResumableStreamStore<TEvent>;
```

Purpose: create an in-memory resumable stream store for examples, tests, and single-process
development. It is not durable and is not safe for multi-worker production replay.

## createUIStreamResponse

```ts
function createUIStreamResponse(
  events: AsyncIterable<UIStreamEvent>,
  options?: CreateEventStreamOptions<UIStreamEvent>,
): Response;
```

Purpose: convert a standard `UIStreamEvent` iterable into an HTTP response for `@anvia/react` hooks.

Default behavior: uses the same JSONL response format and headers as `createEventStream(...)` unless `format: "sse"` is passed.

## createJsonlStream

```ts
function createJsonlStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options?: {
    serialize?: (event: TEvent | { type: "error"; error: unknown }) => string;
  },
): ReadableStream<Uint8Array>;
```

Purpose: encode each event as one JSON line.

Error behavior: if the iterable throws, the stream emits `{ type: "error", error }` and closes.

## createSseStream

```ts
function createSseStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options?: {
    eventName?: string | ((event: TEvent | { type: "error"; error: unknown }) => string | undefined);
    serialize?: (event: TEvent | { type: "error"; error: unknown }) => string;
    retry?: number;
  },
): ReadableStream<Uint8Array>;
```

Purpose: encode each event as a Server-Sent Event with JSON in `data:` fields.

Validation behavior: `retry` must be a finite non-negative integer, and event names must not contain null bytes or line breaks.

For workflow guidance, see [Readable Streams](/docs/advanced/readable-streams).
