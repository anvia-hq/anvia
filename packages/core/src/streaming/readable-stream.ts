import { isJsonValue } from "../completion/json";

export type ReadableStreamOptions = {
  format?: "jsonl";
};

export function toReadableStream<T>(
  events: AsyncIterable<T>,
  _options: ReadableStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done === true) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (error) {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "error", error: serializeError(error) })}\n`),
        );
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    const serialized: { name: string; message: string; code?: unknown; details?: unknown } = {
      name: error.name,
      message: error.message,
    };
    // Runtime-specific Error subclasses (for example bun:sqlite's SqliteError)
    // can keep diagnostic fields such as `code` on the prototype, where
    // JSON.stringify drops them. Copy well-known diagnostic fields explicitly.
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) {
      serialized.code = code;
    }
    const details = (error as { details?: unknown }).details;
    if (details !== undefined) {
      serialized.details = details;
    }
    return serialized;
  }

  if (isJsonValue(error)) {
    return error;
  }

  // A thrown non-Error that is not JSON-safe would serialize as `{}` or lose
  // its diagnostics entirely; degrade to a string payload instead.
  return { message: String(error) };
}
