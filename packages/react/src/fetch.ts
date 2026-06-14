import { readJsonlStream, readSseStream } from "./streams";
import type { EventStreamFormat } from "./types";

export type FetchEventStreamOptions = Omit<RequestInit, "headers"> & {
  format?: EventStreamFormat;
  fetch?: typeof fetch;
  headers?: HeadersInit;
};

export class EventStreamHttpError extends Error {
  constructor(
    readonly response: Response,
    readonly body: string,
  ) {
    super(`Event stream request failed with status ${response.status}`);
    this.name = "EventStreamHttpError";
  }
}

export async function* fetchEventStream<TEvent>(
  input: string | URL | Request,
  options: FetchEventStreamOptions = {},
): AsyncIterable<TEvent> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error("fetchEventStream requires a fetch implementation");
  }

  const response = await fetchImpl(input, fetchOptions(options));
  if (!response.ok) {
    throw new EventStreamHttpError(response, await response.text());
  }
  if (response.body === null) {
    throw new Error("Event stream response does not include a body");
  }

  const format = options.format ?? inferEventStreamFormat(response.headers.get("content-type"));
  if (format === "sse") {
    yield* readSseStream<TEvent>(response.body);
    return;
  }

  yield* readJsonlStream<TEvent>(response.body);
}

function fetchOptions(options: FetchEventStreamOptions): RequestInit {
  const { format: _format, fetch: _fetch, ...init } = options;
  return init;
}

function inferEventStreamFormat(contentType: string | null): EventStreamFormat {
  return contentType?.toLowerCase().includes("text/event-stream") ? "sse" : "jsonl";
}
