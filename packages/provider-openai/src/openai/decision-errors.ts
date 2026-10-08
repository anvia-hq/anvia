import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { DecisionProviderOutputError } from "@anvia/core/decision";

/** Give Core stable transport error names while preserving the SDK error for inspection. */
export function normalizeDecisionError(
  error: unknown,
  modelId: string,
  abortSignal?: AbortSignal,
): unknown {
  if (abortSignal?.aborted) {
    const aborted = new Error("The OpenAI decision request was aborted.", { cause: error });
    aborted.name = "AbortError";
    return aborted;
  }
  if (error instanceof APIConnectionTimeoutError) {
    // SDK timeouts may carry an internal AbortError. Keep it outside the cause chain
    // so Core does not mistake a retryable timeout for caller cancellation.
    return Object.assign(new Error(error.message), { name: "TimeoutError", providerError: error });
  }
  if (error instanceof APIConnectionError) {
    const connection = new Error(error.message, { cause: error });
    connection.name = "APIConnectionError";
    return connection;
  }
  if (error instanceof SyntaxError) {
    return new DecisionProviderOutputError("OpenAI returned invalid decision JSON.", {
      provider: "OpenAI",
      modelId,
      cause: error,
    });
  }
  return error;
}
