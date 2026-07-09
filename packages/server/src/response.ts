import type { UIStreamEvent } from "@anvia/core/ui";
import { createJsonlStream } from "./jsonl";
import { createResumableStream } from "./resumable";
import { createSseStream } from "./sse";
import type {
  CreateEventStreamOptions,
  JsonlStreamOptions,
  ResumableStreamEnvelope,
  SseStreamOptions,
} from "./types";

type ResponseStreamEvent<TEvent> = TEvent | ResumableStreamEnvelope<TEvent>;

export function createEventStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: CreateEventStreamOptions<TEvent> = {},
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

  const eventsForResponse: AsyncIterable<ResponseStreamEvent<TEvent>> =
    options.resumable === undefined
      ? (events as AsyncIterable<ResponseStreamEvent<TEvent>>)
      : createResumableStream(events, options.resumable);
  const body =
    format === "sse"
      ? createSseStream(
          eventsForResponse,
          options.sse as SseStreamOptions<ResponseStreamEvent<TEvent>> | undefined,
        )
      : createJsonlStream(
          eventsForResponse,
          options.jsonl as JsonlStreamOptions<ResponseStreamEvent<TEvent>> | undefined,
        );

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

export function createUIStreamResponse(
  events: AsyncIterable<UIStreamEvent>,
  options: CreateEventStreamOptions<UIStreamEvent> = {},
): Response {
  return createEventStream(events, options);
}
