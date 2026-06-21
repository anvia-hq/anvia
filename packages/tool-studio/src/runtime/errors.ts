import type { JsonValue } from "@anvia/core/completion";
import { serializeUnknown } from "./json";

export function serializeError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return serializeUnknown(error);
}
