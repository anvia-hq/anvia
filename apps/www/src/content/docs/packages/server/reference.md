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
    jsonl?: JsonlStreamOptions<TEvent>;
    sse?: SseStreamOptions<TEvent>;
  },
): Response;
```

Purpose: convert an async iterable of events into an HTTP `Response`.

Default behavior: writes JSONL with `content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, and `x-accel-buffering: no`.

Use `format: "sse"` to emit `text/event-stream`.

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
