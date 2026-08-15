export type EventStreamFormat = "jsonl" | "sse";

export type EventTransportOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: EventTransportOptions): AsyncIterable<TEvent>;
};
