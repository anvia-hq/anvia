import { errorEvent } from "./errors";
import type { EventStreamErrorEvent, SseStreamOptions } from "./types";

export function createSseStream<TEvent>(
  options: SseStreamOptions<TEvent> & { events: AsyncIterable<TEvent> },
): ReadableStream<Uint8Array> {
  validateSseOptions(options);
  const encoder = new TextEncoder();
  const iterator = options.events[Symbol.asyncIterator]();
  const serialize = options.serialize ?? serializeJson;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (options.retry !== undefined) {
        controller.enqueue(encoder.encode(`retry: ${options.retry}\n\n`));
      }
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done === true) {
          controller.close();
          return;
        }

        controller.enqueue(
          encoder.encode(formatSseEvent(next.value, serialize, options.eventName, options.eventId)),
        );
      } catch (error) {
        if (cancelled) return;
        const event = errorEvent(error);
        controller.enqueue(encoder.encode(formatSseEvent(event, serialize, options.eventName)));
        controller.close();
      }
    },
    async cancel() {
      cancelled = true;
      await options.onCancel?.();
      await iterator.return?.();
    },
  });
}

function formatSseEvent<TEvent>(
  event: TEvent | EventStreamErrorEvent,
  serialize: (event: TEvent | EventStreamErrorEvent) => string,
  eventName: SseStreamOptions<TEvent>["eventName"],
  eventId?: SseStreamOptions<TEvent>["eventId"],
): string {
  const name = typeof eventName === "function" ? eventName(event) : eventName;
  const lines: string[] = [];
  const id = eventId?.(event);
  if (id !== undefined) {
    validateSseEventName(id);
    lines.push(`id: ${id}`);
  }

  if (name !== undefined && name.length > 0) {
    validateSseEventName(name);
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

function validateSseOptions<TEvent>(options: SseStreamOptions<TEvent>): void {
  if (options.retry !== undefined && !isValidRetry(options.retry)) {
    throw new TypeError("SSE retry must be a finite non-negative integer");
  }
  if (typeof options.eventName === "string") {
    validateSseEventName(options.eventName);
  }
}

function isValidRetry(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validateSseEventName(name: string): void {
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code === 0 || code === 10 || code === 13) {
      throw new TypeError("SSE event names must not contain null bytes or line breaks");
    }
  }
}
