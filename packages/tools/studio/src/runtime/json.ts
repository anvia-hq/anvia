import type { JsonObject, JsonValue } from "@anvia/core";

export function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === "object") {
    return compactJsonObject(value as Record<string, unknown>);
  }
  return String(value);
}

export function compactJsonObject(values: Record<string, unknown>): JsonObject {
  const entries = Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, toJsonValue(value)]],
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
