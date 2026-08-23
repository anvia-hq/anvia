export function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (source === undefined) {
    return () => undefined;
  }
  if (source.aborted) {
    target.abort(source.reason);
    return () => undefined;
  }

  const onAbort = () => target.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError(signal.reason);
  }
}

export function abortError(reason?: unknown): Error {
  if (isAbortError(reason)) {
    return reason;
  }

  const error = new Error(
    "The operation was aborted.",
    reason === undefined ? undefined : { cause: reason },
  );
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): error is Error {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("name" in current && current.name === "AbortError") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
