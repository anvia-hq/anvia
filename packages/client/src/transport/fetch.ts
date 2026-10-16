import { type EventStreamReadOptions, readJsonlStream, readSseStream } from "./streams";
import type { EventStreamFormat } from "./types";

export type FetchEventStreamOptions = Omit<RequestInit, "headers"> & {
  input: string | URL | Request;
  format?: EventStreamFormat | "auto";
  fetch?: typeof fetch;
  headers?: HeadersInit;
  validateResponse?: (response: Response) => void;
  onParseError?: EventStreamReadOptions["onParseError"];
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
  options: FetchEventStreamOptions,
): AsyncIterable<TEvent> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) throw new Error("fetchEventStream requires a fetch implementation.");

  const response = await fetchImpl(options.input, fetchOptions(options));
  if (!response.ok) throw new EventStreamHttpError(response, await response.text());
  options.validateResponse?.(response);
  if (response.body === null) throw new Error("Event stream response does not include a body.");

  const format =
    options.format === undefined || options.format === "auto"
      ? inferEventStreamFormat(response.headers.get("content-type"))
      : options.format;
  const readOptions: EventStreamReadOptions = {};
  if (options.onParseError !== undefined) readOptions.onParseError = options.onParseError;
  if (format === "sse") {
    yield* readSseStream<TEvent>(response.body, readOptions);
  } else {
    yield* readJsonlStream<TEvent>(response.body, readOptions);
  }
}

function fetchOptions(options: FetchEventStreamOptions): RequestInit {
  const {
    input: _input,
    format: _format,
    fetch: _fetch,
    validateResponse: _validate,
    onParseError: _onParseError,
    ...init
  } = options;
  return init;
}

function inferEventStreamFormat(contentType: string | null): EventStreamFormat {
  return contentType?.toLowerCase().includes("text/event-stream") ? "sse" : "jsonl";
}
