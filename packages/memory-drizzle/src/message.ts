import { isJsonValue, type JsonObject, type JsonValue, type Message } from "@anvia/core";

export function parseMemoryMessage(value: unknown): Message {
  if (!isMemoryMessage(value)) {
    throw new TypeError("Stored Drizzle memory row does not contain a valid Anvia Message.");
  }
  return value;
}

export function isMemoryMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.role !== "string") {
    return false;
  }
  if (value.metadata !== undefined && !isJsonValue(value.metadata)) {
    return false;
  }

  if (value.role === "system") {
    return typeof value.content === "string";
  }

  if (value.role === "user" || value.role === "assistant" || value.role === "tool") {
    return Array.isArray(value.content);
  }

  return false;
}

export function serializeUnknownError(error: unknown): JsonValue {
  if (error instanceof Error) {
    const serialized: JsonObject = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) {
      serialized.stack = error.stack;
    }
    return serialized;
  }

  if (isJsonValue(error)) {
    return error;
  }

  return {
    message: String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
