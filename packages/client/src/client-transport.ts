import { createClientId } from "./messages";
import { ClientProtocolError, parseClientStreamEvent, parseClientStreamFrame } from "./protocol";
import type { CreateFetchEventTransportOptions } from "./transport/event-transport";
import { createFetchEventTransport } from "./transport/event-transport";
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientDataMap,
  type ClientDataSchemas,
  type ClientStream,
  type ClientStreamCursor,
  type ClientStreamFrame,
  type ClientStreamRequest,
  type ClientTransport,
  type ClientTransportOptions,
} from "./types";

export type CreateHttpClientTransportOptions<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
> = Omit<
  CreateFetchEventTransportOptions<TRequest, ClientStreamFrame<TData>>,
  "mapEvent" | "validateResponse"
> & {
  dataSchemas?: ClientDataSchemas<TData>;
};

export function createHttpClientTransport<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
>(options: CreateHttpClientTransportOptions<TRequest, TData>): ClientTransport<TRequest, TData> {
  const transport = createFetchEventTransport<TRequest, ClientStreamFrame<TData>>({
    ...options,
    mapEvent: (event) =>
      parseClientStreamFrame(
        event,
        options.dataSchemas === undefined ? {} : { dataSchemas: options.dataSchemas },
      ),
    validateResponse(response) {
      if (response.headers.get("x-anvia-stream-protocol") !== CLIENT_STREAM_PROTOCOL) {
        throw new ClientProtocolError(
          `Expected x-anvia-stream-protocol: ${CLIENT_STREAM_PROTOCOL}.`,
        );
      }
    },
  });

  return {
    async *send(request, transportOptions) {
      const resume = transportOptions?.resume ?? resumeCursorFromRequest(request);
      yield* validateFrameSequence(transport.send(request, transportOptions), resume);
    },
  };
}

export type CreateDirectClientTransportOptions<TData extends ClientDataMap> = {
  dataSchemas?: ClientDataSchemas<TData>;
};

export function createDirectClientTransport<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
>(
  handler: (
    request: TRequest,
    options: ClientTransportOptions,
  ) => ClientStream<TData> | Promise<ClientStream<TData>>,
  options: CreateDirectClientTransportOptions<TData> = {},
): ClientTransport<TRequest, TData> {
  return {
    async *send(request, transportOptions) {
      const resume = transportOptions?.resume ?? resumeCursorFromRequest(request);
      if (resume !== undefined) {
        throw new ClientProtocolError("Direct client transports do not support resume cursors.");
      }
      const streamId = createClientId("stream");
      let eventId = 0;
      yield {
        type: "stream_start",
        protocol: CLIENT_STREAM_PROTOCOL,
        streamId,
        eventId: 0,
        resumable: false,
      };
      let status: "completed" | "error" = "completed";
      try {
        const events = await handler(request, transportOptions ?? {});
        const iterator = events[Symbol.asyncIterator]();
        let closePromise: Promise<unknown> | undefined;
        const close = () => {
          closePromise ??= Promise.resolve(iterator.return?.());
          return closePromise;
        };
        const onAbort = () => {
          void close();
        };
        transportOptions?.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          while (!transportOptions?.signal?.aborted) {
            const next = await iterator.next();
            if (next.done) break;
            const event = parseClientStreamEvent<TData>(
              next.value,
              options.dataSchemas === undefined ? {} : { dataSchemas: options.dataSchemas },
            );
            eventId += 1;
            yield { type: "stream_event", streamId, eventId, event };
          }
        } finally {
          transportOptions?.signal?.removeEventListener("abort", onAbort);
          await close();
        }
      } catch {
        status = "error";
      }
      yield { type: "stream_end", streamId, eventId, status };
    },
  };
}

async function* validateFrameSequence<TData extends ClientDataMap>(
  frames: AsyncIterable<ClientStreamFrame<TData>>,
  resume: ClientStreamCursor | undefined,
): AsyncIterable<ClientStreamFrame<TData>> {
  let streamId: string | undefined;
  let lastEventId = resume?.after ?? 0;
  let ended = false;
  for await (const frame of frames) {
    if (ended) throw new ClientProtocolError("Received a frame after stream_end.", frame);
    if (streamId === undefined) {
      if (frame.type !== "stream_start") {
        throw new ClientProtocolError("The first client stream frame must be stream_start.", frame);
      }
      streamId = frame.streamId;
      if (resume !== undefined && frame.streamId !== resume.streamId) {
        throw new ClientProtocolError("Resume response streamId does not match the cursor.", frame);
      }
      if (resume !== undefined && !frame.resumable) {
        throw new ClientProtocolError("Resume response must identify a resumable stream.", frame);
      }
    } else if (frame.type === "stream_start") {
      throw new ClientProtocolError("Received more than one stream_start frame.", frame);
    } else if (frame.streamId !== streamId) {
      throw new ClientProtocolError("Client streamId changed during the response.", frame);
    }
    if (frame.type === "stream_event") {
      if (frame.eventId !== lastEventId + 1) {
        throw new ClientProtocolError("Client stream event IDs must be contiguous.", frame);
      }
      lastEventId = frame.eventId;
    } else if (frame.type === "stream_end") {
      if (frame.eventId !== lastEventId) {
        throw new ClientProtocolError("stream_end has an invalid eventId.", frame);
      }
      ended = true;
    }
    yield frame;
  }
  if (streamId === undefined || !ended) {
    throw new ClientProtocolError("Client stream ended without a complete frame sequence.");
  }
}

function resumeCursorFromRequest(value: unknown): ClientStreamCursor | undefined {
  if (typeof value !== "object" || value === null || !("resume" in value)) return undefined;
  const resume = value.resume;
  if (typeof resume !== "object" || resume === null) return undefined;
  if (!("streamId" in resume) || !("after" in resume)) return undefined;
  return typeof resume.streamId === "string" &&
    typeof resume.after === "number" &&
    Number.isSafeInteger(resume.after) &&
    resume.after >= 0
    ? { streamId: resume.streamId, after: resume.after }
    : undefined;
}
