import {
  CLIENT_STREAM_PROTOCOL,
  type ClientDataMap,
  type ClientDataSchemas,
  type ClientMetadata,
  type ClientMetadataSchema,
  ClientProtocolError,
  type ClientStream,
  type ClientStreamEvent,
  type ClientStreamFrame,
  createClientId,
  parseClientStreamEvent,
} from "@anvia/client";
import { encodeEventStreamResponse } from "./response";
import type { EventStreamFormat, ResumableStreamStore } from "./types";

type ClientResponseOptions<Metadata extends ClientMetadata, Data extends ClientDataMap> = {
  format?: EventStreamFormat;
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
  metadataSchema?: ClientMetadataSchema<Metadata>;
  dataSchemas?: ClientDataSchemas<Data>;
  sse?: { retry?: number };
};

export type ClientResumableEvent<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  protocol: typeof CLIENT_STREAM_PROTOCOL;
  event: ClientStreamEvent<Metadata, Data>;
};

export type CreateClientStreamResponseOptions<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = ClientResponseOptions<Metadata, Data> & {
  events: ClientStream<Metadata, Data>;
  streamId?: string;
  resumable?: {
    streamId: string;
    store: ResumableStreamStore<ClientResumableEvent<Metadata, Data>>;
  };
};

export type ResumeClientStreamResponseOptions<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = ClientResponseOptions<Metadata, Data> & {
  streamId: string;
  after: number;
  store: ResumableStreamStore<ClientResumableEvent<Metadata, Data>>;
};

export function createClientStreamResponse<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(options: CreateClientStreamResponseOptions<Metadata, Data>): Response {
  const frames =
    options.resumable === undefined
      ? frameClientStream(
          options.events,
          options.streamId ?? createClientId("stream"),
          options.metadataSchema,
          options.dataSchemas,
        )
      : frameResumableClientStream(
          options.events,
          options.resumable.streamId,
          options.resumable.store,
          options.metadataSchema,
          options.dataSchemas,
        );
  return clientResponse(frames, options);
}

export function resumeClientStreamResponse<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(options: ResumeClientStreamResponseOptions<Metadata, Data>): Response {
  return clientResponse(
    resumeClientFrames(
      options.streamId,
      options.after,
      options.store,
      options.metadataSchema,
      options.dataSchemas,
    ),
    options,
  );
}

function frameClientStream<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  events: ClientStream<Metadata, Data>,
  streamId: string,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
): AsyncIterable<ClientStreamFrame<Metadata, Data>> {
  return propagateCancellation(events, (source) => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "stream_start",
        protocol: CLIENT_STREAM_PROTOCOL,
        streamId,
        eventId: 0,
        resumable: false,
      } satisfies ClientStreamFrame<Metadata, Data>;
      let eventId = 0;
      let status: "completed" | "error" = "completed";
      try {
        for await (const value of source) {
          const event = parseEvent(value, metadataSchema, dataSchemas);
          eventId += 1;
          yield {
            type: "stream_event",
            streamId,
            eventId,
            event,
          } satisfies ClientStreamFrame<Metadata, Data>;
        }
      } catch {
        status = "error";
      }
      yield { type: "stream_end", streamId, eventId, status } satisfies ClientStreamFrame<
        Metadata,
        Data
      >;
    },
  }));
}

function frameResumableClientStream<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  events: ClientStream<Metadata, Data>,
  streamId: string,
  store: ResumableStreamStore<ClientResumableEvent<Metadata, Data>>,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
): AsyncIterable<ClientStreamFrame<Metadata, Data>> {
  let open: Promise<void> | undefined;
  function start(): Promise<void> {
    if (open !== undefined) return open;
    open = store.open({ streamId }).then(() => undefined);
    void drainClientStream(events, streamId, store, metadataSchema, dataSchemas, open);
    return open;
  }
  return {
    async *[Symbol.asyncIterator]() {
      try {
        await start();
      } catch {
        yield startFrame<Metadata, Data>(streamId, true);
        yield endFrame<Metadata, Data>(streamId, 0, "error");
        return;
      }
      yield* resumeClientFrames(streamId, 0, store, metadataSchema, dataSchemas);
    },
  };
}

async function drainClientStream<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  events: ClientStream<Metadata, Data>,
  streamId: string,
  store: ResumableStreamStore<ClientResumableEvent<Metadata, Data>>,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
  open: Promise<void>,
): Promise<void> {
  try {
    await open;
    for await (const value of events) {
      await store.append({
        streamId,
        event: {
          protocol: CLIENT_STREAM_PROTOCOL,
          event: parseEvent(value, metadataSchema, dataSchemas),
        },
      });
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

async function* resumeClientFrames<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  streamId: string,
  after: number,
  store: ResumableStreamStore<ClientResumableEvent<Metadata, Data>>,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
): AsyncIterable<ClientStreamFrame<Metadata, Data>> {
  yield startFrame<Metadata, Data>(streamId, true);
  let eventId = after;
  let invalid = false;
  try {
    for await (const record of store.subscribe({ streamId, after })) {
      const event = parseResumableEvent(record.event, metadataSchema, dataSchemas);
      eventId = record.eventId;
      yield { type: "stream_event", streamId, eventId, event };
    }
  } catch {
    invalid = true;
  }

  try {
    const state = await store.status({ streamId });
    const status = invalid || state.status === "running" ? "error" : state.status;
    yield endFrame<Metadata, Data>(streamId, Math.max(eventId, state.lastEventId), status);
  } catch {
    yield endFrame<Metadata, Data>(streamId, eventId, "error");
  }
}

function parseResumableEvent<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  value: unknown,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
): ClientStreamEvent<Metadata, Data> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientProtocolError("Invalid client resumable record.", value);
  }
  const record = value as { protocol?: unknown; event?: unknown };
  if (record.protocol === "anvia.client.v1") {
    throw new ClientProtocolError("Client resumable protocol v1 is not supported.", value);
  }
  if (record.protocol !== CLIENT_STREAM_PROTOCOL || !("event" in record)) {
    throw new ClientProtocolError(
      "Client resumable records must use the current client protocol.",
      value,
    );
  }
  return parseEvent(record.event, metadataSchema, dataSchemas);
}

function parseEvent<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  value: unknown,
  metadataSchema: ClientMetadataSchema<Metadata> | undefined,
  dataSchemas: ClientDataSchemas<Data> | undefined,
): ClientStreamEvent<Metadata, Data> {
  return parseClientStreamEvent<Metadata, Data>(value, {
    ...(metadataSchema === undefined ? {} : { metadataSchema }),
    ...(dataSchemas === undefined ? {} : { dataSchemas }),
  });
}

function startFrame<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  streamId: string,
  resumable: boolean,
): ClientStreamFrame<Metadata, Data> {
  return {
    type: "stream_start",
    protocol: CLIENT_STREAM_PROTOCOL,
    streamId,
    eventId: 0,
    resumable,
  };
}

function endFrame<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  streamId: string,
  eventId: number,
  status: "completed" | "error" | "missing",
): ClientStreamFrame<Metadata, Data> {
  return { type: "stream_end", streamId, eventId, status };
}

function clientResponse<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  frames: AsyncIterable<ClientStreamFrame<Metadata, Data>>,
  options: ClientResponseOptions<Metadata, Data>,
): Response {
  const headers = new Headers(options.headers);
  headers.set("x-anvia-stream-protocol", CLIENT_STREAM_PROTOCOL);
  return encodeEventStreamResponse({
    events: frames,
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
