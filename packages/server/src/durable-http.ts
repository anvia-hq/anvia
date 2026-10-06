import { createEventStreamResponse } from "./response";

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
export function listQuery(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(query, key)) throw new TypeError("Duplicate query parameter.");
    if (key === "after" || key === "limit") {
      if (!/^\d+$/.test(value)) throw new TypeError("Invalid pagination.");
      query[key] = Number(value);
    } else query[key] = value;
  }
  return query;
}
export function durableEventsResponse<T extends { sequence: number }>(
  request: Request,
  cursor: number,
  stream: (options: { after: number; abortSignal: AbortSignal }) => AsyncIterable<T>,
): Response {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? "0";
  if (!/^\d+$/.test(rawCursor)) throw new TypeError("Invalid event cursor.");
  const after = Number(rawCursor);
  if (!Number.isSafeInteger(after) || after > cursor) throw new TypeError("Invalid event cursor.");
  const detached = new AbortController();
  const signal = AbortSignal.any([request.signal, detached.signal]);
  return createEventStreamResponse({
    events: stream({ after, abortSignal: signal }),
    format: "sse",
    headers: { "cache-control": "no-store, no-transform" },
    sse: {
      eventName: "durable",
      eventId: (event) => ("sequence" in event ? String(event.sequence) : undefined),
      serialize: (event) =>
        JSON.stringify(
          "sequence" in event ? event : { type: "error", error: "Durable stream interrupted." },
        ),
      onCancel: () => {
        detached.abort(new Error("Durable subscriber disconnected."));
      },
    },
  });
}

export class HttpInputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    throw new HttpInputError(415, "Expected application/json");
  if (request.body === null) throw new HttpInputError(400, "Expected a JSON body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new HttpInputError(413, "Durable request body is too large");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}
