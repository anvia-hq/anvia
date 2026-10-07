import { APITimeoutError } from "@typesafe-ai/sdk";

/** Distinguish SDK timeout cancellation from cancellation requested by the caller. */
export function normalizeJevError(error: unknown, abortSignal?: AbortSignal): unknown {
  if (abortSignal?.aborted) {
    const aborted = new Error("The Jev request was aborted.", { cause: error });
    aborted.name = "AbortError";
    return aborted;
  }
  if (error instanceof APITimeoutError) {
    // The SDK timeout cause is AbortError. Keep it outside the cause chain so core
    // retries recognize a timeout without mistaking it for caller cancellation.
    return Object.assign(new Error(error.message), { name: "TimeoutError", providerError: error });
  }
  return error;
}
