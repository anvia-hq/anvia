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
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}
