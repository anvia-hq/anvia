import type { JsonObject, JsonValue } from "@anvia/core/completion";

export function toJsonValue(value: unknown): JsonValue {
  return toJsonValueInternal(value, new WeakSet<object>());
}

function toJsonValueInternal(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    try {
      return value.map((item) => toJsonValueInternal(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    try {
      return compactJsonObjectInternal(value as Record<string, unknown>, seen);
    } finally {
      seen.delete(value);
    }
  }
  return String(value);
}

export function compactJsonObject(values: Record<string, unknown>): JsonObject {
  return compactJsonObjectInternal(values, new WeakSet<object>());
}

function compactJsonObjectInternal(
  values: Record<string, unknown>,
  seen: WeakSet<object>,
): JsonObject {
  const entries = Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, toJsonValueInternal(value, seen)]],
  );
  return Object.fromEntries(entries) as JsonObject;
}

export function serializeUnknown(error: unknown): JsonValue {
  if (error instanceof Error) {
    return compactJsonObject({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  return toJsonValue(error);
}
