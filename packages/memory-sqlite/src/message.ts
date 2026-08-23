import {
  isJsonValue,
  isMessage,
  type JsonObject,
  type JsonValue,
  type Message,
  parseMessage,
} from "@anvia/core";

export function parseMemoryMessage(value: unknown): Message {
  try {
    return parseMessage(value);
  } catch (error) {
    throw new TypeError("Stored SQLite memory row does not contain a valid Anvia Message.", {
      cause: error,
    });
  }
}

export function isMemoryMessage(value: unknown): value is Message {
  return isMessage(value);
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
