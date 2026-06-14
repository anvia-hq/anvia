export async function* readJsonlStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<TEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          yield JSON.parse(trimmed) as TEvent;
        }
      }
    }

    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      yield JSON.parse(trimmed) as TEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* readSseStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<TEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = createEmptySseEvent();

  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const parsed = parseSseLine(line, event);
        event = parsed.event;
        if (parsed.complete === true && parsed.data !== undefined) {
          yield JSON.parse(parsed.data) as TEvent;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      const parsed = parseSseLine(buffer, event);
      event = parsed.event;
      if (parsed.complete === true && parsed.data !== undefined) {
        yield JSON.parse(parsed.data) as TEvent;
      }
    }
    const data = flushSseEvent(event);
    if (data !== undefined) {
      yield JSON.parse(data) as TEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

function createEmptySseEvent(): { data: string[] } {
  return { data: [] };
}

function parseSseLine(
  line: string,
  event: { data: string[] },
): { event: { data: string[] }; complete?: true; data?: string } {
  if (line === "") {
    const data = flushSseEvent(event);
    return data === undefined
      ? { event: createEmptySseEvent(), complete: true }
      : { event: createEmptySseEvent(), complete: true, data };
  }

  if (line.startsWith(":")) {
    return { event };
  }

  const separator = line.indexOf(":");
  const field = separator === -1 ? line : line.slice(0, separator);
  const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

  if (field === "data") {
    event.data.push(value);
  }

  return { event };
}

function flushSseEvent(event: { data: string[] }): string | undefined {
  if (event.data.length === 0) {
    return undefined;
  }

  return event.data.join("\n");
}
