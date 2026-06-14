import type { EventStreamErrorEvent } from "./types";

export function errorEvent(error: unknown): EventStreamErrorEvent {
  return {
    type: "error",
    error: serializeError(error),
  };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}
