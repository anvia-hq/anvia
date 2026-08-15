export async function* readJsonlStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<TEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const value = line.trim();
        if (value.length > 0) yield JSON.parse(value) as TEvent;
      }
    }
    buffer += decoder.decode();
    const value = buffer.trim();
    if (value.length > 0) yield JSON.parse(value) as TEvent;
  } finally {
    if (!completed) await cancelReader(reader);
    reader.releaseLock();
  }
}

export async function* readSseStream<TEvent>(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<TEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let completed = false;

  function parseLine(line: string): string | undefined {
    if (line === "") {
      const complete = data.length === 0 ? undefined : data.join("\n");
      data = [];
      return complete;
    }
    if (line.startsWith(":")) return undefined;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    return undefined;
  }

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const complete = parseLine(line);
        if (complete !== undefined) yield JSON.parse(complete) as TEvent;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const complete = parseLine(buffer);
      if (complete !== undefined) yield JSON.parse(complete) as TEvent;
    }
    if (data.length > 0) yield JSON.parse(data.join("\n")) as TEvent;
  } finally {
    if (!completed) await cancelReader(reader);
    reader.releaseLock();
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request may already have been aborted by its owner.
  }
}
