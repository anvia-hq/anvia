import { type FetchEventStreamOptions, fetchEventStream } from "./fetch";
import type { EventStreamFormat, EventTransport, EventTransportOptions } from "./types";

export type CreateFetchEventTransportOptions<TRequest, TEvent> = {
  endpoint: string | URL | ((request: TRequest) => string | URL);
  method?: string;
  format?: EventStreamFormat | "auto";
  fetch?: typeof fetch;
  headers?: HeadersInit | ((request: TRequest) => HeadersInit | Promise<HeadersInit>);
  body?: (request: TRequest) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;
  init?: Omit<RequestInit, "body" | "headers" | "method" | "signal">;
  mapEvent?: (event: unknown) => TEvent;
  validateResponse?: (response: Response) => void;
};

export function createFetchEventTransport<TRequest, TEvent = unknown>(
  options: CreateFetchEventTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent> {
  return {
    async *send(request, transportOptions = {}) {
      const endpoint =
        typeof options.endpoint === "function" ? options.endpoint(request) : options.endpoint;
      const requestHeaders = await resolveHeaders(options.headers, request);
      const headers = mergeHeaders(requestHeaders, transportOptions.headers);
      const method = options.method ?? "POST";
      const body = await resolveBody(options.body, request, headers, method);
      const init: FetchEventStreamOptions = {
        ...options.init,
        method,
        headers,
        format: options.format ?? "auto",
      };
      if (body !== undefined) init.body = body;
      if (transportOptions.signal !== undefined) init.signal = transportOptions.signal;
      if (options.fetch !== undefined) init.fetch = options.fetch;
      if (options.validateResponse !== undefined) init.validateResponse = options.validateResponse;

      for await (const event of fetchEventStream<unknown>(endpoint, init)) {
        yield options.mapEvent === undefined ? (event as TEvent) : options.mapEvent(event);
      }
    },
  };
}

export function createDirectEventTransport<TRequest, TEvent>(
  handler: (request: TRequest, options: EventTransportOptions) => AsyncIterable<TEvent>,
): EventTransport<TRequest, TEvent> {
  return {
    async *send(request, options) {
      const iterator = handler(request, options ?? {})[Symbol.asyncIterator]();
      let closePromise: Promise<unknown> | undefined;
      const close = () => {
        closePromise ??= Promise.resolve(iterator.return?.());
        return closePromise;
      };
      const onAbort = () => {
        void close();
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!options?.signal?.aborted) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        options?.signal?.removeEventListener("abort", onAbort);
        await close();
      }
    },
  };
}

async function resolveHeaders<TRequest>(
  headers: CreateFetchEventTransportOptions<TRequest, unknown>["headers"],
  request: TRequest,
): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? headers(request) : headers;
}

async function resolveBody<TRequest>(
  body: CreateFetchEventTransportOptions<TRequest, unknown>["body"],
  request: TRequest,
  headers: Headers,
  method: string,
): Promise<BodyInit | null | undefined> {
  if (body !== undefined) return body(request);
  if (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") return undefined;
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(request);
}

function mergeHeaders(...values: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();
  for (const value of values) {
    if (value === undefined) continue;
    new Headers(value).forEach((headerValue, key) => {
      headers.set(key, headerValue);
    });
  }
  return headers;
}
