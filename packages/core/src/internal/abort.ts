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

export function isAbortError(error: unknown): error is Error {
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

export function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (delayMs === 0) return Promise.resolve();
  if (signal === undefined) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
