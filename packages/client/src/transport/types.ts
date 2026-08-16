export type EventStreamFormat = "jsonl" | "sse";

export type EventTransportSendOptions<TRequest> = {
  request: TRequest;
  abortSignal?: AbortSignal;
  headers?: HeadersInit;
};

export type EventTransport<TRequest, TEvent> = {
  send(options: EventTransportSendOptions<TRequest>): AsyncIterable<TEvent>;
};
