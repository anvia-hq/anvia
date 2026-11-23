const RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 25;

/**
 * Retries transient Langfuse failures (network errors, 429 and 5xx) with the same
 * attempt shape the score queue uses. Other responses are returned to the caller so
 * it can surface the server's error body.
 */
export async function fetchLangfuse(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);

      if (response.ok || (response.status !== 429 && response.status < 500)) {
        return response;
      }

      lastResponse = response;
    } catch (error) {
      lastError = error;
    }

    if (attempt < RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));
    }
  }

  if (lastResponse !== undefined) return lastResponse;

  throw lastError instanceof Error ? lastError : new Error("Langfuse request failed");
}
