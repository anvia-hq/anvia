import { type FetchEventStreamOptions, fetchEventStream } from "./fetch";
import type { EventStreamFormat, EventTransport, EventTransportSendOptions } from "./types";

export type EventTransportContext<TRequest> = EventTransportSendOptions<TRequest>;

export type EventTransportBodyContext<TRequest> = Omit<
  EventTransportContext<TRequest>,
  "headers"
> & {
  headers: Headers;
};

export type CreateFetchEventTransportOptions<TRequest, TEvent> = {
  endpoint: string | URL | ((context: EventTransportContext<TRequest>) => string | URL);
  method?: string;
  format?: EventStreamFormat | "auto";
  fetch?: typeof fetch;
  headers?:
    | HeadersInit
    | ((context: EventTransportContext<TRequest>) => HeadersInit | Promise<HeadersInit>);
  body?: (
    context: EventTransportBodyContext<TRequest>,
  ) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;
  init?: Omit<RequestInit, "body" | "headers" | "method" | "signal">;
  mapEvent?: (event: unknown) => TEvent;
  validateResponse?: (response: Response) => void;
};

export function createFetchEventTransport<TRequest, TEvent = unknown>(
  options: CreateFetchEventTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent> {
  return {
    async *send(transportOptions) {
      const endpoint =
        typeof options.endpoint === "function"
          ? options.endpoint(transportOptions)
          : options.endpoint;
      const requestHeaders = await resolveHeaders(options.headers, transportOptions);
      const headers = mergeHeaders(requestHeaders, transportOptions.headers);
      const method = options.method ?? "POST";
      const body = await resolveBody(options.body, transportOptions, headers, method);
      const init: FetchEventStreamOptions = {
        ...options.init,
        input: endpoint,
        method,
        headers,
        format: options.format ?? "auto",
      };
      if (body !== undefined) init.body = body;
      if (transportOptions.abortSignal !== undefined) init.signal = transportOptions.abortSignal;
      if (options.fetch !== undefined) init.fetch = options.fetch;
      if (options.validateResponse !== undefined) init.validateResponse = options.validateResponse;

      for await (const event of fetchEventStream<unknown>(init)) {
        yield options.mapEvent === undefined ? (event as TEvent) : options.mapEvent(event);
      }
    },
  };
}

export function createDirectEventTransport<TRequest, TEvent>(options: {
  handler(context: EventTransportContext<TRequest>): AsyncIterable<TEvent>;
}): EventTransport<TRequest, TEvent> {
  return {
    async *send(context) {
      const iterator = options.handler(context)[Symbol.asyncIterator]();
      let closePromise: Promise<unknown> | undefined;
      const close = () => {
        closePromise ??= Promise.resolve(iterator.return?.());
        return closePromise;
      };
      const onAbort = () => {
        void close();
      };
      context.abortSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!context.abortSignal?.aborted) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        context.abortSignal?.removeEventListener("abort", onAbort);
        await close();
      }
    },
  };
}

async function resolveHeaders<TRequest>(
  headers: CreateFetchEventTransportOptions<TRequest, unknown>["headers"],
  context: EventTransportContext<TRequest>,
): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? headers(context) : headers;
}

async function resolveBody<TRequest>(
  body: CreateFetchEventTransportOptions<TRequest, unknown>["body"],
  context: EventTransportContext<TRequest>,
  headers: Headers,
  method: string,
): Promise<BodyInit | null | undefined> {
  if (body !== undefined) return body({ ...context, headers });
  if (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") return undefined;
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(context.request);
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
