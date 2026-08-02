import type { UIStreamEvent } from "@anvia/core/ui";
import { createJsonlStream } from "./jsonl";
import { createResumableStream, resumeStreamEvents } from "./resumable";
import { createSseStream } from "./sse";
import type {
  CreateEventStreamOptions,
  CreateEventStreamResumeOptions,
  EventStreamFormat,
  JsonlStreamOptions,
  ResumableStreamEnvelope,
  ResumableStreamStore,
  SseStreamOptions,
} from "./types";

type ResponseStreamEvent<TEvent> = TEvent | ResumableStreamEnvelope<TEvent>;

type EventStreamResponseOptions<TEvent> = {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  jsonl?: JsonlStreamOptions<ResponseStreamEvent<TEvent>>;
  sse?: SseStreamOptions<ResponseStreamEvent<TEvent>>;
};

export function createEventStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options?: CreateEventStreamOptions<TEvent>,
): Response;
export function createEventStream<TEvent>(
  options: CreateEventStreamResumeOptions<TEvent>,
): Response;
export function createEventStream<TEvent>(
  eventsOrOptions: AsyncIterable<TEvent> | CreateEventStreamResumeOptions<TEvent>,
  options: CreateEventStreamOptions<TEvent> = {},
): Response {
  if (isResumeOptions(eventsOrOptions)) {
    const resume = eventsOrOptions.resume;
    return createEventStreamResponse(
      resumeStreamEvents({
        id: resume.streamId,
        after: resume.after,
        store: resume.store,
      }),
      copyResponseOptions(eventsOrOptions),
    );
  }

  const eventsForResponse: AsyncIterable<ResponseStreamEvent<TEvent>> =
    options.resumable === undefined
      ? (eventsOrOptions as AsyncIterable<ResponseStreamEvent<TEvent>>)
      : createResumableStream(eventsOrOptions, options.resumable);

  return createEventStreamResponse(eventsForResponse, copyResponseOptions(options));
}

export function createUIStreamResponse(
  events: AsyncIterable<UIStreamEvent>,
  options?: CreateEventStreamOptions<UIStreamEvent>,
): Response;
export function createUIStreamResponse(
  options: CreateEventStreamResumeOptions<UIStreamEvent>,
): Response;
export function createUIStreamResponse(
  eventsOrOptions: AsyncIterable<UIStreamEvent> | CreateEventStreamResumeOptions<UIStreamEvent>,
  options: CreateEventStreamOptions<UIStreamEvent> = {},
): Response {
  if (isResumeOptions(eventsOrOptions)) {
    return createEventStream(eventsOrOptions);
  }

  return createEventStream(eventsOrOptions, options);
}

function createEventStreamResponse<TEvent>(
  events: AsyncIterable<ResponseStreamEvent<TEvent>>,
  options: EventStreamResponseOptions<TEvent>,
): Response {
  const format = options.format ?? "jsonl";
  const headers = new Headers(options.headers);

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-cache, no-transform");
  }
  if (!headers.has("connection")) {
    headers.set("connection", "keep-alive");
  }
  if (!headers.has("x-accel-buffering")) {
    headers.set("x-accel-buffering", "no");
  }

  const body =
    format === "sse"
      ? createSseStream(events, options.sse)
      : createJsonlStream(events, options.jsonl);

  if (!headers.has("content-type")) {
    headers.set(
      "content-type",
      format === "sse" ? "text/event-stream; charset=utf-8" : "application/x-ndjson; charset=utf-8",
    );
  }

  const responseInit: ResponseInit = { headers };
  if (options.status !== undefined) {
    responseInit.status = options.status;
  }
  if (options.statusText !== undefined) {
    responseInit.statusText = options.statusText;
  }

  return new Response(body, responseInit);
}

function copyResponseOptions<TEvent>(options: {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  jsonl?: unknown;
  sse?: unknown;
}): EventStreamResponseOptions<TEvent> {
  const next: EventStreamResponseOptions<TEvent> = {};
  if (options.format !== undefined) next.format = options.format;
  if (options.headers !== undefined) next.headers = options.headers;
  if (options.status !== undefined) next.status = options.status;
  if (options.statusText !== undefined) next.statusText = options.statusText;
  if (options.jsonl !== undefined) {
    next.jsonl = options.jsonl as JsonlStreamOptions<ResponseStreamEvent<TEvent>>;
  }
  if (options.sse !== undefined) {
    next.sse = options.sse as SseStreamOptions<ResponseStreamEvent<TEvent>>;
  }
  return next;
}

function isResumeOptions<TEvent>(
  value: AsyncIterable<TEvent> | CreateEventStreamResumeOptions<TEvent>,
): value is CreateEventStreamResumeOptions<TEvent> {
  if (typeof value !== "object" || value === null || Symbol.asyncIterator in value) {
    return false;
  }
  if (!("resume" in value) || typeof value.resume !== "object" || value.resume === null) {
    return false;
  }

  const resume = value.resume as {
    streamId?: unknown;
    after?: unknown;
    store?: unknown;
  };
  return (
    typeof resume.streamId === "string" &&
    typeof resume.after === "number" &&
    Number.isFinite(resume.after) &&
    resume.after >= 0 &&
    isResumableStreamStore(resume.store)
  );
}

function isResumableStreamStore(value: unknown): value is ResumableStreamStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}
