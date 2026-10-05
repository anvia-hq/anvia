export class EvalTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Evaluation case exceeded its timeout of ${timeoutMs}ms.`);
    this.name = "EvalTimeoutError";
  }
}

export class EvalAbortError extends Error {
  constructor(message = "Evaluation run was aborted.") {
    super(message);
    this.name = "EvalAbortError";
  }
}

export type EvalCaseSignal = {
  signal: AbortSignal;
  dispose(): void;
};

export function createEvalCaseSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): EvalCaseSignal {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason ?? new EvalAbortError());
  if (parent?.aborted === true) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(new EvalTimeoutError(timeoutMs)), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      if (timeout !== undefined) clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

export type EvalInvocationSignal = {
  signal: AbortSignal | undefined;
  dispose(): void;
};

export function composeEvalSignals(
  caseSignal: AbortSignal | undefined,
  requestSignal: AbortSignal | undefined,
): EvalInvocationSignal {
  const signals = [...new Set([caseSignal, requestSignal])].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (signals.length < 2) return { signal: signals[0], dispose() {} };
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted !== undefined) return { signal: aborted, dispose() {} };

  const controller = new AbortController();
  const links = new Map<AbortSignal, () => void>();
  const dispose = () => {
    for (const [signal, listener] of links) signal.removeEventListener("abort", listener);
    links.clear();
  };
  for (const signal of signals) {
    const listener = () => {
      controller.abort(abortReason(signal));
      dispose();
    };
    links.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

export function abortable<T>(signal: AbortSignal | undefined, operation: Promise<T>): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export type ConcurrencyLimiter = <T>(operation: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(concurrency: number): ConcurrencyLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new EvalAbortError();
}
