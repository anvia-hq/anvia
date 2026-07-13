import { type FetchEventStreamOptions, fetchEventStream } from "./fetch";
import type { EventStreamFormat, EventTransport } from "./types";

export type CreateFetchTransportOptions<TRequest, TEvent> = {
  endpoint: string | URL | ((request: TRequest) => string | URL);
  method?: string;
  format?: EventStreamFormat;
  fetch?: typeof fetch;
  headers?: HeadersInit | ((request: TRequest) => HeadersInit | Promise<HeadersInit>);
  body?: (request: TRequest) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;
  init?: Omit<RequestInit, "body" | "headers" | "method" | "signal">;
  mapEvent?: (event: unknown) => TEvent;
};

export function createFetchTransport<TRequest, TEvent = unknown>(
  options: CreateFetchTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent> {
  return {
    async *send(request, transportOptions = {}) {
      const endpoint =
        typeof options.endpoint === "function" ? options.endpoint(request) : options.endpoint;
      const requestHeaders = await resolveHeaders(options.headers, request);
      const headers = mergeHeaders(requestHeaders, transportOptions.headers);
      const method = options.method ?? "POST";
      const body = await resolveBody(options.body, request, headers, method);
      const init: FetchEventStreamOptions = {};
      Object.assign(init, options.init);
      init.method = method;
      init.headers = headers;
      init.format = options.format ?? "jsonl";

      if (body !== undefined) {
        init.body = body;
      }
      if (transportOptions.signal !== undefined) {
        init.signal = transportOptions.signal;
      }
      if (options.fetch !== undefined) {
        init.fetch = options.fetch;
      }

      for await (const event of fetchEventStream<unknown>(endpoint, init)) {
        yield options.mapEvent === undefined ? (event as TEvent) : options.mapEvent(event);
      }
    },
  };
}

export function createChatTransport<TRequest, TEvent = unknown>(
  options: CreateFetchTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent> {
  return createFetchTransport(options);
}

async function resolveHeaders<TRequest>(
  headers: CreateFetchTransportOptions<TRequest, unknown>["headers"],
  request: TRequest,
): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? headers(request) : headers;
}

async function resolveBody<TRequest>(
  body: CreateFetchTransportOptions<TRequest, unknown>["body"],
  request: TRequest,
  headers: Headers,
  method: string,
): Promise<BodyInit | null | undefined> {
  if (body !== undefined) {
    return body(request);
  }

  if (!methodAllowsDefaultBody(method)) {
    return undefined;
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return JSON.stringify(request);
}

function methodAllowsDefaultBody(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}

function mergeHeaders(...values: (HeadersInit | undefined)[]): Headers {
  const headers = new Headers();

  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    new Headers(value).forEach((headerValue, key) => {
      headers.set(key, headerValue);
    });
  }

  return headers;
}
