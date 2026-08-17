export const DEFAULT_CAPTURE_MAX_BYTES = 262_144;
export const MIN_CAPTURE_MAX_BYTES = 96;

type TruncatedTraceValue = {
  anviaTraceValue: "truncated";
  originalBytes: number;
  preview: string;
};

type OmittedTraceValue = {
  anviaTraceValue: "omitted";
  reason: "base64" | "binary" | "circular" | "depth" | "unserializable";
  originalBytes?: number;
};

export function validateCaptureMaxBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_CAPTURE_MAX_BYTES;
  if (!Number.isInteger(resolved) || resolved < MIN_CAPTURE_MAX_BYTES) {
    throw new TypeError(
      `Langfuse captureMaxBytes must be an integer of at least ${MIN_CAPTURE_MAX_BYTES}`,
    );
  }
  return resolved;
}

export function sanitizeTraceValue<T>(
  value: T,
  maxBytes: number,
): T | TruncatedTraceValue | OmittedTraceValue {
  validateCaptureMaxBytes(maxBytes);
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>()) as T;
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized) ?? String(sanitized);
  } catch {
    return omitted("unserializable");
  }
  const originalBytes = utf8Bytes(serialized);
  if (originalBytes <= maxBytes) {
    return sanitized;
  }
  const preview = boundedPreview(serialized, originalBytes, maxBytes);
  return {
    anviaTraceValue: "truncated",
    originalBytes,
    preview,
  };
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > 16) {
    return omitted("depth");
  }
  if (typeof value === "string") {
    if (/^data:[^;,]+;base64,/i.test(value)) {
      return omitted("base64", utf8Bytes(value));
    }
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const byteLength = value.byteLength;
    return omitted("binary", byteLength);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return omitted("circular");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => sanitizeValue(entry, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "data" &&
      typeof entry === "string" &&
      (record.type === "base64" ||
        (record.type === "image" && typeof record.mediaType === "string"))
    ) {
      result[key] = omitted("base64", utf8Bytes(entry));
      continue;
    }
    result[key] = sanitizeValue(entry, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function omitted(reason: OmittedTraceValue["reason"], originalBytes?: number): OmittedTraceValue {
  const value: OmittedTraceValue = {
    anviaTraceValue: "omitted",
    reason,
  };
  if (originalBytes !== undefined) value.originalBytes = originalBytes;
  return value;
}

function boundedPreview(value: string, originalBytes: number, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = {
      anviaTraceValue: "truncated" as const,
      originalBytes,
      preview: value.slice(0, middle),
    };
    if (utf8Bytes(JSON.stringify(candidate)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

function utf8Bytes(value: string): number {
  return typeof Buffer === "undefined"
    ? new TextEncoder().encode(value).byteLength
    : Buffer.byteLength(value, "utf8");
}
