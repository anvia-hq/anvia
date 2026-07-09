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
  resumable?: CreateResumableStreamOptions<TEvent>;
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

export type ResumableStreamFinalStatus = "completed" | "error";
export type ResumableStreamStatus = "running" | ResumableStreamFinalStatus | "missing";

export type ResumableStreamState = {
  status: ResumableStreamStatus;
  lastEventId: number;
};

export type ResumableStreamRecord<TEvent> = {
  streamId: string;
  eventId: number;
  event: TEvent | EventStreamErrorEvent;
  createdAt?: Date;
};

export type ResumableStreamEnvelope<TEvent> =
  | {
      type: "stream_start";
      streamId: string;
      eventId: 0;
    }
  | {
      type: "stream_event";
      streamId: string;
      eventId: number;
      event: TEvent | EventStreamErrorEvent;
    }
  | {
      type: "stream_end";
      streamId: string;
      eventId: number;
      status: ResumableStreamStatus;
    };

export type CreateResumableStreamOptions<TEvent> = {
  id: string;
  store: ResumableStreamStore<TEvent>;
};

export type ResumeStreamEventsOptions<TEvent> = {
  id: string;
  after?: number;
  store: ResumableStreamStore<TEvent>;
};

export type ResumableStreamOpenInput = {
  streamId: string;
};

export type ResumableStreamAppendInput<TEvent> = {
  streamId: string;
  event: TEvent | EventStreamErrorEvent;
};

export type ResumableStreamSubscribeInput = {
  streamId: string;
  after?: number;
};

export type ResumableStreamStatusInput = {
  streamId: string;
};

export type ResumableStreamCloseInput = {
  streamId: string;
  status: ResumableStreamFinalStatus;
};

export interface ResumableStreamStore<TEvent = unknown> {
  open(input: ResumableStreamOpenInput): Promise<ResumableStreamState>;
  append(input: ResumableStreamAppendInput<TEvent>): Promise<ResumableStreamRecord<TEvent>>;
  subscribe(input: ResumableStreamSubscribeInput): AsyncIterable<ResumableStreamRecord<TEvent>>;
  status(input: ResumableStreamStatusInput): Promise<ResumableStreamState>;
  close(input: ResumableStreamCloseInput): Promise<ResumableStreamState>;
}
