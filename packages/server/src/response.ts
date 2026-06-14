import { createJsonlStream } from "./jsonl";
import { createSseStream } from "./sse";
import type { CreateEventStreamOptions } from "./types";

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
