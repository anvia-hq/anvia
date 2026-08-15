import { createJsonlStream } from "./jsonl";
import { createResumableStream, resumeStreamEvents } from "./resumable";
import { createSseStream } from "./sse";
import type {
  CreateEventStreamResponseOptions,
  EventStreamFormat,
  JsonlStreamOptions,
  ResumableStreamEnvelope,
  ResumeEventStreamResponseOptions,
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

export function createEventStreamResponse<TEvent>(
  events: AsyncIterable<TEvent>,
  options: CreateEventStreamResponseOptions<TEvent> = {},
): Response {
  const eventsForResponse: AsyncIterable<ResponseStreamEvent<TEvent>> =
    options.resumable === undefined
      ? (events as AsyncIterable<ResponseStreamEvent<TEvent>>)
      : createResumableStream(events, options.resumable);

  return encodeEventStreamResponse(eventsForResponse, copyResponseOptions(options));
}

export function resumeEventStreamResponse<TEvent>(
  options: ResumeEventStreamResponseOptions<TEvent>,
): Response {
  return encodeEventStreamResponse(
    resumeStreamEvents({
      id: options.streamId,
      after: options.after,
      store: options.store,
    }),
    copyResponseOptions(options),
  );
}

export function encodeEventStreamResponse<TEvent>(
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
