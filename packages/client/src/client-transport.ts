import type { JsonObject } from "@anvia/core/completion";
import { createClientId } from "./messages";
import { ClientProtocolError, parseClientStreamEvent, parseClientStreamFrame } from "./protocol";
import type { CreateFetchEventTransportOptions } from "./transport/event-transport";
import { createFetchEventTransport } from "./transport/event-transport";
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientDataMap,
  type ClientDataSchemas,
  type ClientMetadataSchema,
  type ClientStream,
  type ClientStreamCursor,
  type ClientStreamFrame,
  type ClientStreamRequest,
  type ClientTransport,
} from "./types";

export type CreateHttpClientTransportOptions<
  TRequest = ClientStreamRequest,
  Data extends ClientDataMap = ClientDataMap,
  Metadata extends JsonObject = JsonObject,
> = Omit<
  CreateFetchEventTransportOptions<TRequest, ClientStreamFrame<Metadata, Data>>,
  "mapEvent" | "validateResponse"
> & {
  metadataSchema?: ClientMetadataSchema<Metadata>;
  dataSchemas?: ClientDataSchemas<Data>;
};

export function createHttpClientTransport<
  TRequest = ClientStreamRequest,
  Data extends ClientDataMap = ClientDataMap,
  Metadata extends JsonObject = JsonObject,
>(
  options: CreateHttpClientTransportOptions<TRequest, Data, Metadata>,
): ClientTransport<TRequest, Data, Metadata> {
  const transport = createFetchEventTransport<TRequest, ClientStreamFrame<Metadata, Data>>({
    ...options,
    mapEvent: (event) => parseClientStreamFrame(event, protocolOptions(options)),
    validateResponse(response) {
      if (response.headers.get("x-anvia-stream-protocol") !== CLIENT_STREAM_PROTOCOL) {
        throw new ClientProtocolError(
          `Expected x-anvia-stream-protocol: ${CLIENT_STREAM_PROTOCOL}.`,
        );
      }
    },
  });

  return {
    async *send(sendOptions) {
      const resume = sendOptions.resume ?? resumeCursorFromRequest(sendOptions.request);
      yield* validateFrameSequence(transport.send(sendOptions), resume);
    },
  };
}

export type CreateDirectClientTransportOptions<
  TRequest,
  Data extends ClientDataMap,
  Metadata extends JsonObject,
> = {
  handler(options: {
    request: TRequest;
    abortSignal?: AbortSignal;
    headers?: HeadersInit;
  }): ClientStream<Metadata, Data> | Promise<ClientStream<Metadata, Data>>;
  metadataSchema?: ClientMetadataSchema<Metadata>;
  dataSchemas?: ClientDataSchemas<Data>;
};

export function createDirectClientTransport<
  TRequest = ClientStreamRequest,
  Data extends ClientDataMap = ClientDataMap,
  Metadata extends JsonObject = JsonObject,
>(
  options: CreateDirectClientTransportOptions<TRequest, Data, Metadata>,
): ClientTransport<TRequest, Data, Metadata> {
  return {
    async *send(sendOptions) {
      const resume = sendOptions.resume ?? resumeCursorFromRequest(sendOptions.request);
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
        const events = await options.handler({
          request: sendOptions.request,
          ...(sendOptions.abortSignal === undefined
            ? {}
            : { abortSignal: sendOptions.abortSignal }),
          ...(sendOptions.headers === undefined ? {} : { headers: sendOptions.headers }),
        });
        const iterator = events[Symbol.asyncIterator]();
        let closePromise: Promise<unknown> | undefined;
        const close = () => {
          closePromise ??= Promise.resolve(iterator.return?.());
          return closePromise;
        };
        const onAbort = () => {
          void close();
        };
        sendOptions.abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          while (!sendOptions.abortSignal?.aborted) {
            const next = await iterator.next();
            if (next.done) break;
            const event = parseClientStreamEvent<Metadata, Data>(
              next.value,
              protocolOptions(options),
            );
            eventId += 1;
            yield { type: "stream_event", streamId, eventId, event };
          }
        } finally {
          sendOptions.abortSignal?.removeEventListener("abort", onAbort);
          await close();
        }
      } catch {
        status = "error";
      }
      yield { type: "stream_end", streamId, eventId, status };
    },
  };
}

async function* validateFrameSequence<Metadata extends JsonObject, Data extends ClientDataMap>(
  frames: AsyncIterable<ClientStreamFrame<Metadata, Data>>,
  resume: ClientStreamCursor | undefined,
): AsyncIterable<ClientStreamFrame<Metadata, Data>> {
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

function protocolOptions<Metadata extends JsonObject, Data extends ClientDataMap>(options: {
  metadataSchema?: ClientMetadataSchema<Metadata>;
  dataSchemas?: ClientDataSchemas<Data>;
}): {
  metadataSchema?: ClientMetadataSchema<Metadata>;
  dataSchemas?: ClientDataSchemas<Data>;
} {
  return {
    ...(options.metadataSchema === undefined ? {} : { metadataSchema: options.metadataSchema }),
    ...(options.dataSchemas === undefined ? {} : { dataSchemas: options.dataSchemas }),
  };
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
