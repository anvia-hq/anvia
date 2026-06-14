import { errorEvent } from "./errors";
import type { JsonlStreamOptions } from "./types";

export function createJsonlStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: JsonlStreamOptions<TEvent> = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  const serialize = options.serialize ?? serializeJson;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done === true) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`${serialize(next.value)}\n`));
      } catch (error) {
        controller.enqueue(encoder.encode(`${serialize(errorEvent(error))}\n`));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}
