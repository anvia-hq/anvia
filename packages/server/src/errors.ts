import { isJsonValue } from "@anvia/client";
import type { EventStreamErrorEvent } from "./types";

export function errorEvent(error: unknown): EventStreamErrorEvent {
  return {
    type: "error",
    error: serializeError(error),
  };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    const serialized: {
      name: string;
      message: string;
      code?: string;
      retryable?: boolean;
      details?: unknown;
    } = {
      name: error.name,
      message: error.message,
    };
    const code = (error as { code?: unknown }).code;

    if (typeof code === "string") {
      serialized.code = code;
    }

    const retryable = (error as { retryable?: unknown }).retryable;

    if (typeof retryable === "boolean") {
      serialized.retryable = retryable;
    }

    if (isJsonValue((error as { details?: unknown }).details)) {
      serialized.details = (error as { details?: unknown }).details;
    }

    return serialized;
  }

  if (!isJsonValue(error)) {
    return { message: String(error) };
  }

  return error;
}
