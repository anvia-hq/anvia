export type EventStreamFormat = "jsonl" | "sse";

export type EventStreamErrorEvent = {
  type: "error";
  error: unknown;
};

export type CreateEventStreamOptions<TEvent> = {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  jsonl?: JsonlStreamOptions<TEvent>;
  sse?: SseStreamOptions<TEvent>;
};

export type JsonlStreamOptions<TEvent> = {
  serialize?: (event: TEvent | EventStreamErrorEvent) => string;
};

export type SseStreamOptions<TEvent> = {
  eventName?: string | ((event: TEvent | EventStreamErrorEvent) => string | undefined);
  serialize?: (event: TEvent | EventStreamErrorEvent) => string;
  retry?: number;
};
