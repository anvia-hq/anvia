import type { EventStreamFormat } from "./types";

/** A malformed JSONL line or SSE data payload that could not be parsed as JSON. */
export class EventStreamParseError extends Error {
  readonly format: EventStreamFormat;
  /** The raw JSONL line or joined SSE `data` payload. */
  readonly raw: string;
  /** 1-based physical line number of the malformed JSONL line. */
  readonly line: number | undefined;
  /** SSE event name of the malformed frame. */
  readonly event: string | undefined;
  /** SSE last event ID in effect when the malformed frame was dispatched. */
  readonly lastEventId: string | undefined;

  constructor(options: {
    format: EventStreamFormat;
    raw: string;
    cause: unknown;
    line?: number;
    event?: string;
    lastEventId?: string;
  }) {
    super(`Malformed ${options.format === "sse" ? "SSE" : "JSONL"} frame: invalid JSON.`, {
      cause: options.cause,
    });
    this.name = "EventStreamParseError";
    this.format = options.format;
    this.raw = options.raw;
    this.line = options.line;
    this.event = options.event;
    this.lastEventId = options.lastEventId;
  }
}

export type EventStreamReadOptions = {
  /**
   * Receives frames whose payload is not valid JSON. Malformed frames are skipped and the
   * stream continues. Throwing from this callback aborts the stream with that error.
   */
  onParseError?: (error: EventStreamParseError) => void;
  /** Throw the parse error instead of skipping malformed frames. */
  strict?: boolean;
};

/** A dispatched Server-Sent Event with its parsed JSON payload. */
export type SseFrame<TEvent> = {
  data: TEvent;
  /** Event name from the `event:` field, `"message"` when absent. */
  event: string;
  /** Last event ID set by an `id:` field in this or an earlier frame, `""` when none. */
  lastEventId: string;
  /** Most recent valid `retry:` reconnection time in milliseconds. */
  retry?: number;
};

export async function* readJsonlStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
  options: EventStreamReadOptions = {},
): AsyncIterable<TEvent> {
  let lineNumber = 0;
  for await (const line of readLines(stream)) {
    lineNumber += 1;
    const raw = line.trim();
    if (raw.length === 0) continue;
    const parsed = parseJson(raw, options, () => ({ format: "jsonl", raw, line: lineNumber }));
    if (parsed.ok) yield parsed.value as TEvent;
  }
}

export async function* readSseStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
  options: EventStreamReadOptions = {},
): AsyncIterable<TEvent> {
  for await (const frame of readSseFrames<TEvent>(stream, options)) yield frame.data;
}

export async function* readSseFrames<TEvent>(
  stream: ReadableStream<Uint8Array>,
  options: EventStreamReadOptions = {},
): AsyncIterable<SseFrame<TEvent>> {
  let data: string[] = [];
  let event = "";
  let lastEventId = "";
  let retry: number | undefined;

  function dispatch(): SseFrame<TEvent> | undefined {
    const raw = data.join("\n");
    const name = event === "" ? "message" : event;
    const hasData = data.length > 0;
    data = [];
    event = "";
    // Whitespace-only payloads (for example `data:` heartbeats) carry no JSON event.
    if (!hasData || raw.trim().length === 0) return undefined;
    const parsed = parseJson(raw, options, () => ({
      format: "sse",
      raw,
      event: name,
      lastEventId,
    }));
    if (!parsed.ok) return undefined;
    const frame: SseFrame<TEvent> = { data: parsed.value as TEvent, event: name, lastEventId };
    if (retry !== undefined) frame.retry = retry;
    return frame;
  }

  for await (const line of readLines(stream)) {
    if (line === "") {
      const frame = dispatch();
      if (frame !== undefined) yield frame;
      continue;
    }
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      data.push(value);
    } else if (field === "event") {
      event = value;
    } else if (field === "id") {
      if (!value.includes("\0")) lastEventId = value;
    } else if (field === "retry") {
      if (/^\d+$/.test(value)) retry = Number(value);
    }
  }
  // Leniently dispatch a final event that was not followed by a blank line.
  const frame = dispatch();
  if (frame !== undefined) yield frame;
}

/** Splits a byte stream into lines terminated by CRLF, LF, or a bare CR. */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let skipLeadingLf = false;
  let completed = false;

  function* split(text: string): Iterable<string> {
    let chunk = text;
    if (skipLeadingLf && chunk.length > 0) {
      skipLeadingLf = false;
      if (chunk.startsWith("\n")) chunk = chunk.slice(1);
    }
    let start = 0;
    let index = buffer.length;
    buffer += chunk;
    for (; index < buffer.length; index += 1) {
      const char = buffer.charCodeAt(index);
      if (char !== 10 && char !== 13) continue;
      yield buffer.slice(start, index);
      if (char === 13) {
        if (index + 1 === buffer.length) skipLeadingLf = true;
        else if (buffer.charCodeAt(index + 1) === 10) index += 1;
      }
      start = index + 1;
    }
    buffer = buffer.slice(start);
  }

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      yield* split(decoder.decode(next.value, { stream: true }));
    }
    yield* split(decoder.decode());
    if (buffer.length > 0) yield buffer;
  } finally {
    if (!completed) await cancelReader(reader);
    reader.releaseLock();
  }
}

function parseJson(
  raw: string,
  options: EventStreamReadOptions,
  details: () => Omit<ConstructorParameters<typeof EventStreamParseError>[0], "cause">,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (cause) {
    const error = new EventStreamParseError({ ...details(), cause });
    options.onParseError?.(error);
    if (options.strict === true) throw error;
    return { ok: false };
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request may already have been aborted by its owner.
  }
}
