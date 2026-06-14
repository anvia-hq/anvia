import { errorEvent } from "./errors";
import type { EventStreamErrorEvent, SseStreamOptions } from "./types";

export function createSseStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: SseStreamOptions<TEvent> = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  const serialize = options.serialize ?? serializeJson;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (options.retry !== undefined) {
        controller.enqueue(encoder.encode(`retry: ${options.retry}\n\n`));
      }
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done === true) {
          controller.close();
          return;
        }

        controller.enqueue(
          encoder.encode(formatSseEvent(next.value, serialize, options.eventName)),
        );
      } catch (error) {
        const event = errorEvent(error);
        controller.enqueue(encoder.encode(formatSseEvent(event, serialize, options.eventName)));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function formatSseEvent<TEvent>(
  event: TEvent | EventStreamErrorEvent,
  serialize: (event: TEvent | EventStreamErrorEvent) => string,
  eventName: SseStreamOptions<TEvent>["eventName"],
): string {
  const name = typeof eventName === "function" ? eventName(event) : eventName;
  const lines: string[] = [];

  if (name !== undefined && name.length > 0) {
    lines.push(`event: ${name}`);
  }

  for (const line of serialize(event).split(/\r?\n/)) {
    lines.push(`data: ${line}`);
  }

  lines.push("", "");
  return lines.join("\n");
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}
