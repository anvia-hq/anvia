import { createEventStream } from "@anvia/server";
import { serializeError } from "./http";

type StudioStreamErrorEvent = {
  type: "error";
  error: unknown;
};

const studioJsonlHeaders: HeadersInit = {
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "content-type": "application/x-ndjson; charset=utf-8",
  "transfer-encoding": "chunked",
  "x-accel-buffering": "no",
};

export function streamStudioJsonl<TEvent>(events: AsyncIterable<TEvent>): Response {
  return createEventStream(withStudioStreamErrors(events), {
    format: "jsonl",
    headers: studioJsonlHeaders,
  });
}

function withStudioStreamErrors<TEvent>(
  events: AsyncIterable<TEvent>,
): AsyncIterable<TEvent | StudioStreamErrorEvent> {
  const iterator = events[Symbol.asyncIterator]();
  let done = false;

  return {
    [Symbol.asyncIterator](): AsyncIterator<TEvent | StudioStreamErrorEvent> {
      return {
        async next(): Promise<IteratorResult<TEvent | StudioStreamErrorEvent>> {
          if (done) {
            return { done: true, value: undefined };
          }

          try {
            const next = await iterator.next();
            if (next.done === true) {
              done = true;
            }
            return next;
          } catch (error) {
            done = true;
            return {
              done: false,
              value: studioStreamError(error),
            };
          }
        },
        async return(): Promise<IteratorResult<TEvent | StudioStreamErrorEvent>> {
          done = true;
          await iterator.return?.();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function studioStreamError(error: unknown): StudioStreamErrorEvent {
  return {
    type: "error",
    error: serializeError(error),
  };
}
