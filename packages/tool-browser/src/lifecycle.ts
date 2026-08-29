import { BrowserError, cancellationError } from "./errors";
import type { BrowserLifecycleOptions } from "./types";

export const defaultLifecycleTimeoutMs = 120_000;
const maxTimerMs = 2_147_483_647;

export type BoundedSignal = {
  signal: AbortSignal;
  timedOut: () => boolean;
  throwIfAborted: () => void;
  normalize: (
    error: unknown,
    message: string,
    code: "startup_failed" | "transport_failure",
  ) => BrowserError;
  dispose: () => void;
};

export function boundedSignal(
  options: BrowserLifecycleOptions,
  defaultTimeoutMs: number,
  phase: string,
): BoundedSignal {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  assertPositiveSafeInteger(timeoutMs, "timeoutMs");
  if (options.abortSignal?.aborted) throw cancellationError(options.abortSignal.reason, phase);
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new BrowserError(`Browser lifecycle operation timed out: ${phase}.`, "lifecycle_timeout", {
          phase,
        }),
      ),
    timeoutMs,
  );
  timer.unref?.();
  const signal =
    options.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([options.abortSignal, controller.signal]);
  return {
    signal,
    timedOut: () => controller.signal.aborted,
    throwIfAborted: () => {
      if (options.abortSignal?.aborted) {
        throw cancellationError(options.abortSignal.reason, phase);
      }
      if (controller.signal.aborted) throw controller.signal.reason;
    },
    normalize: (error, message, code) => {
      if (options.abortSignal?.aborted) {
        return error instanceof AggregateError
          ? new BrowserError("Browser operation was cancelled by the caller.", "cancelled", {
              cause: error,
              phase,
            })
          : cancellationError(options.abortSignal.reason, phase);
      }
      if (controller.signal.aborted) {
        const reason = controller.signal.reason as BrowserError;
        return error === reason
          ? reason
          : new BrowserError(reason.message, "lifecycle_timeout", { cause: error, phase });
      }
      if (error instanceof BrowserError) return error;
      return new BrowserError(message, code, { cause: error, phase });
    },
    dispose: () => clearTimeout(timer),
  };
}

export function validateLifecycleOptions(options: BrowserLifecycleOptions, phase: string): void {
  if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
  if (options.abortSignal?.aborted) {
    throw cancellationError(options.abortSignal.reason, phase);
  }
}

export async function waitForSharedLifecycle(
  promise: Promise<void>,
  options: BrowserLifecycleOptions,
  phase: string,
): Promise<void> {
  const bounded = boundedSignal(options, defaultLifecycleTimeoutMs, phase);
  try {
    await waitForPromise(promise, bounded.signal);
    bounded.throwIfAborted();
  } catch (error) {
    throw bounded.normalize(error, `Unable to wait for ${phase}.`, "transport_failure");
  } finally {
    bounded.dispose();
  }
}

export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maxTimerMs) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maxTimerMs}.`);
  }
}

export function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("options must be an object.");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForPromise<T>(promise: Promise<T>, abortSignal: AbortSignal): Promise<T> {
  abortSignal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(abortSignal.reason));
    abortSignal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
