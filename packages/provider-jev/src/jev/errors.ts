import { APITimeoutError } from "@typesafe-ai/sdk";

/** Distinguish SDK timeout cancellation from cancellation requested by the caller. */
export function normalizeJevError(error: unknown, abortSignal?: AbortSignal): unknown {
  if (abortSignal?.aborted) {
    const aborted = new Error("The Jev request was aborted.", { cause: error });
    aborted.name = "AbortError";
    return aborted;
  }

  if (error instanceof APITimeoutError) {
    return Object.assign(new Error(error.message), { name: "TimeoutError", providerError: error });
  }

  return error;
}
