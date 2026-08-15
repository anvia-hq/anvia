import {
  CLIENT_STREAM_PROTOCOL,
  type ClientDataMap,
  type ClientDataSchemas,
  type ClientStream,
  type ClientStreamEvent,
  type ClientStreamFrame,
  createClientId,
  parseClientStreamEvent,
} from "@anvia/client";
import { encodeEventStreamResponse } from "./response";
import type { EventStreamFormat, ResumableStreamStore } from "./types";

type ClientResponseOptions<TData extends ClientDataMap> = {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  dataSchemas?: ClientDataSchemas<TData>;
  sse?: { retry?: number };
};

export type CreateClientStreamResponseOptions<TData extends ClientDataMap = ClientDataMap> =
  ClientResponseOptions<TData> & {
    streamId?: string;
    resumable?: {
      streamId: string;
      store: ResumableStreamStore<ClientStreamEvent<TData>>;
    };
  };

export type ResumeClientStreamResponseOptions<TData extends ClientDataMap = ClientDataMap> =
  ClientResponseOptions<TData> & {
    streamId: string;
    after: number;
    store: ResumableStreamStore<ClientStreamEvent<TData>>;
  };

export function createClientStreamResponse<TData extends ClientDataMap = ClientDataMap>(
  events: ClientStream<TData>,
  options: CreateClientStreamResponseOptions<TData> = {},
): Response {
  const frames =
    options.resumable === undefined
      ? frameClientStream(events, options.streamId ?? createClientId("stream"), options.dataSchemas)
      : frameResumableClientStream(
          events,
          options.resumable.streamId,
          options.resumable.store,
          options.dataSchemas,
        );
  return clientResponse(frames, options);
}

export function resumeClientStreamResponse<TData extends ClientDataMap = ClientDataMap>(
  options: ResumeClientStreamResponseOptions<TData>,
): Response {
  return clientResponse(
    resumeClientFrames(options.streamId, options.after, options.store, options.dataSchemas),
    options,
  );
}

function frameClientStream<TData extends ClientDataMap>(
  events: ClientStream<TData>,
  streamId: string,
  schemas: ClientDataSchemas<TData> | undefined,
): AsyncIterable<ClientStreamFrame<TData>> {
  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "stream_start",
        protocol: CLIENT_STREAM_PROTOCOL,
        streamId,
        eventId: 0,
        resumable: false,
      } satisfies ClientStreamFrame<TData>;
      let eventId = 0;
      let status: "completed" | "error" = "completed";
      try {
        for await (const value of source) {
          const event = parseEvent(value, schemas);
          eventId += 1;
          yield {
            type: "stream_event",
            streamId,
            eventId,
            event,
          } satisfies ClientStreamFrame<TData>;
        }
      } catch {
        status = "error";
      }
      yield { type: "stream_end", streamId, eventId, status } satisfies ClientStreamFrame<TData>;
    },
  }));
}

function frameResumableClientStream<TData extends ClientDataMap>(
  events: ClientStream<TData>,
  streamId: string,
  store: ResumableStreamStore<ClientStreamEvent<TData>>,
  schemas: ClientDataSchemas<TData> | undefined,
): AsyncIterable<ClientStreamFrame<TData>> {
  let open: Promise<void> | undefined;
  function start(): Promise<void> {
    if (open !== undefined) return open;
    open = store.open({ streamId }).then(() => undefined);
    void drainClientStream(events, streamId, store, schemas, open);
    return open;
  }
  return {
    async *[Symbol.asyncIterator]() {
      try {
        await start();
      } catch {
        yield startFrame<TData>(streamId, true);
        yield endFrame<TData>(streamId, 0, "error");
        return;
      }
      yield* resumeClientFrames(streamId, 0, store, schemas);
    },
  };
}

async function drainClientStream<TData extends ClientDataMap>(
  events: ClientStream<TData>,
  streamId: string,
  store: ResumableStreamStore<ClientStreamEvent<TData>>,
  schemas: ClientDataSchemas<TData> | undefined,
  open: Promise<void>,
): Promise<void> {
  try {
    await open;
    for await (const value of events) {
      await store.append({ streamId, event: parseEvent(value, schemas) });
    }
    await store.close({ streamId, status: "completed" });
  } catch {
    try {
      await store.close({ streamId, status: "error" });
    } catch {
      // A failed store open has no stream to close.
    }
  }
}

async function* resumeClientFrames<TData extends ClientDataMap>(
  streamId: string,
  after: number,
  store: ResumableStreamStore<ClientStreamEvent<TData>>,
  schemas: ClientDataSchemas<TData> | undefined,
): AsyncIterable<ClientStreamFrame<TData>> {
  yield startFrame<TData>(streamId, true);
  let eventId = after;
  let invalid = false;
  try {
    for await (const record of store.subscribe({ streamId, after })) {
      const event = parseEvent(record.event, schemas);
      eventId = record.eventId;
      yield { type: "stream_event", streamId, eventId, event };
    }
  } catch {
    invalid = true;
  }

  try {
    const state = await store.status({ streamId });
    const status = invalid || state.status === "running" ? "error" : state.status;
    yield endFrame<TData>(streamId, Math.max(eventId, state.lastEventId), status);
  } catch {
    yield endFrame<TData>(streamId, eventId, "error");
  }
}

function parseEvent<TData extends ClientDataMap>(
  value: unknown,
  schemas: ClientDataSchemas<TData> | undefined,
): ClientStreamEvent<TData> {
  return parseClientStreamEvent<TData>(
    value,
    schemas === undefined ? {} : { dataSchemas: schemas },
  );
}

function startFrame<TData extends ClientDataMap>(
  streamId: string,
  resumable: boolean,
): ClientStreamFrame<TData> {
  return {
    type: "stream_start",
    protocol: CLIENT_STREAM_PROTOCOL,
    streamId,
    eventId: 0,
    resumable,
  };
}

function endFrame<TData extends ClientDataMap>(
  streamId: string,
  eventId: number,
  status: "completed" | "error" | "missing",
): ClientStreamFrame<TData> {
  return { type: "stream_end", streamId, eventId, status };
}

function clientResponse<TData extends ClientDataMap>(
  frames: AsyncIterable<ClientStreamFrame<TData>>,
  options: ClientResponseOptions<TData>,
): Response {
  const headers = new Headers(options.headers);
  headers.set("x-anvia-stream-protocol", CLIENT_STREAM_PROTOCOL);
  return encodeEventStreamResponse(frames, {
    ...(options.format === undefined ? {} : { format: options.format }),
    headers,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.statusText === undefined ? {} : { statusText: options.statusText }),
    ...(options.sse === undefined ? {} : { sse: options.sse }),
  });
}

function propagateCancellation<TSource, TOutput>(
  source: AsyncIterable<TSource>,
  transform: (source: AsyncIterable<TSource>) => AsyncIterable<TOutput>,
): AsyncIterable<TOutput> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<TOutput> {
      const sourceIterator = source[Symbol.asyncIterator]();
      const sharedSource: AsyncIterable<TSource> = {
        [Symbol.asyncIterator]: () => sourceIterator,
      };
      const outputIterator = transform(sharedSource)[Symbol.asyncIterator]();
      let returned = false;

      return {
        next: () => outputIterator.next(),
        async return(): Promise<IteratorResult<TOutput>> {
          if (returned) return { done: true, value: undefined };
          returned = true;
          const sourceReturn = sourceIterator.return?.();
          const outputReturn = outputIterator.return?.();
          await Promise.all([sourceReturn, outputReturn]);
          return { done: true, value: undefined };
        },
      };
    },
  };
}
