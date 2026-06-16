import type { EventTransport } from "./types";

export function createDirectTransport<TRequest, TEvent>(
  handler: (request: TRequest) => AsyncIterable<TEvent>,
): EventTransport<TRequest, TEvent> {
  return {
    async *send(request, options) {
      const iterable = handler(request);
      const iterator = iterable[Symbol.asyncIterator]();
      try {
        while (true) {
          if (options?.signal?.aborted) {
            break;
          }

          const next = await iterator.next();
          if (next.done) {
            break;
          }

          yield next.value;
        }
      } finally {
        await iterator.return?.();
      }
    },
  };
}
