import { type AnyTool, type ToolCallContext, type Toolkit } from "@anvia/core/tool";
import { wrapToolOrToolkit } from "../internal/tool-wrapper";

export type ToolTimeoutOptions = {
  /** Maximum execution duration per tool call in milliseconds. */
  timeoutMs: number;
  /** Optional allowlist of tool names to wrap when targeting a Toolkit. */
  tools?: readonly string[] | undefined;
  /** Optional custom timeout error message. */
  message?: string | undefined;
};

export type ToolRetryOptions = {
  /** Maximum total attempts (initial call + retries). Default 3. */
  maxAttempts?: number | undefined;
  /** Initial backoff delay in milliseconds before the first retry. Default 250. */
  backoffMs?: number | undefined;
  /** Maximum backoff delay in milliseconds. Default 5_000. */
  maxBackoffMs?: number | undefined;
  /** Exponential multiplier applied to backoff between retries. Default 2. */
  backoffFactor?: number | undefined;
  /** Optional predicate deciding whether a thrown error should be retried. Default retries all non-abort errors. */
  retryOn?: ((error: unknown, attempt: number) => boolean) | undefined;
  /** Optional allowlist of tool names to wrap when targeting a Toolkit. */
  tools?: readonly string[] | undefined;
  /** Optional custom sleep function for deterministic testing. */
  sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
};

export type ToolRateLimitOptions = {
  /** Maximum permitted calls per tool within `windowMs`. */
  maxCalls: number;
  /** Sliding time window in milliseconds. */
  windowMs: number;
  /** Optional allowlist of tool names to rate-limit when targeting a Toolkit. */
  tools?: readonly string[] | undefined;
  /** Optional custom clock for deterministic testing. Default `Date.now`. */
  now?: (() => number) | undefined;
  /** Optional custom error message when rate limited. */
  message?: string | undefined;
};

export function withToolTimeout<T extends AnyTool | Toolkit>(
  target: T,
  options: ToolTimeoutOptions,
): T {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("withToolTimeout timeoutMs must be a positive finite number.");
  }

  return wrapToolOrToolkit(target, {
    wrapperName: "withToolTimeout",
    tools: options.tools,
    wrapCall(tool, args, context) {
      return callWithTimeout(tool, args, context, options.timeoutMs, options.message);
    },
  });
}

export function withToolRetry<T extends AnyTool | Toolkit>(
  target: T,
  options: ToolRetryOptions = {},
): T {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 250;
  const maxBackoffMs = options.maxBackoffMs ?? 5_000;
  const backoffFactor = options.backoffFactor ?? 2;
  const sleepImpl = options.sleep ?? sleepWithAbort;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new RangeError("withToolRetry maxAttempts must be a positive safe integer.");
  }

  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new RangeError("withToolRetry backoffMs must be a non-negative finite number.");
  }

  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < 0) {
    throw new RangeError("withToolRetry maxBackoffMs must be a non-negative finite number.");
  }

  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
    throw new RangeError("withToolRetry backoffFactor must be a finite number >= 1.");
  }

  return wrapToolOrToolkit(target, {
    wrapperName: "withToolRetry",
    tools: options.tools,
    async wrapCall(tool, args, context) {
      let attempt = 0;

      while (true) {
        throwIfAborted(context?.abortSignal, `Tool "${tool.name}" was aborted.`);
        attempt += 1;

        try {
          return await tool.call(args, context);
        } catch (error) {
          if (context?.abortSignal?.aborted || attempt >= maxAttempts) {
            throw error;
          }

          if (options.retryOn !== undefined && !options.retryOn(error, attempt)) {
            throw error;
          }

          const delay = Math.min(maxBackoffMs, backoffMs * backoffFactor ** (attempt - 1));

          if (delay > 0) {
            await sleepImpl(delay, context?.abortSignal);
          }
        }
      }
    },
  });
}

export function withToolRateLimit<T extends AnyTool | Toolkit>(
  target: T,
  options: ToolRateLimitOptions,
): T {
  if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls <= 0) {
    throw new RangeError("withToolRateLimit maxCalls must be a positive safe integer.");
  }

  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError("withToolRateLimit windowMs must be a positive finite number.");
  }

  const now = options.now ?? Date.now;
  const callHistory = new Map<string, number[]>();

  return wrapToolOrToolkit(target, {
    wrapperName: "withToolRateLimit",
    tools: options.tools,
    async wrapCall(tool, args, context) {
      throwIfAborted(context?.abortSignal, `Tool "${tool.name}" was aborted.`);

      const currentTime = now();
      const cutoff = currentTime - options.windowMs;
      const timestamps = callHistory.get(tool.name) ?? [];
      const active = timestamps.filter((ts) => ts > cutoff);

      if (active.length >= options.maxCalls) {
        callHistory.set(tool.name, active);
        throw new Error(
          options.message ??
            `Tool "${tool.name}" exceeded rate limit (${options.maxCalls} calls per ${options.windowMs}ms).`,
        );
      }

      active.push(currentTime);
      callHistory.set(tool.name, active);
      return await tool.call(args, context);
    },
  });
}

async function callWithTimeout(
  tool: AnyTool,
  args: unknown,
  context: ToolCallContext | undefined,
  timeoutMs: number,
  customMessage: string | undefined,
): Promise<unknown> {
  throwIfAborted(context?.abortSignal, `Tool "${tool.name}" was aborted.`);

  const controller = new AbortController();
  const timeoutError = new Error(
    customMessage ?? `Tool "${tool.name}" timed out after ${timeoutMs}ms.`,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;

  const raceRejection = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      try {
        controller.abort(timeoutError);
      } catch {
        return;
      }
    }, timeoutMs);
    timer.unref();

    if (context?.abortSignal !== undefined) {
      onParentAbort = () => {
        const reason = context.abortSignal?.reason;
        reject(reason instanceof Error ? reason : new Error(`Tool "${tool.name}" was aborted.`));
      };
      context.abortSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  });

  const combinedSignal =
    context?.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([context.abortSignal, controller.signal]);
  const nextContext: ToolCallContext = {
    ...context,
    abortSignal: combinedSignal,
  };

  try {
    return await Promise.race([
      Promise.resolve().then(() => tool.call(args, nextContext)),
      raceRejection,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (onParentAbort !== undefined) {
      context?.abortSignal?.removeEventListener("abort", onParentAbort);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined, fallbackMessage: string): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error(fallbackMessage);
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const reason = signal.reason;
      reject(reason instanceof Error ? reason : new Error("Retry sleep aborted."));
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      const reason = signal?.reason;
      reject(reason instanceof Error ? reason : new Error("Retry sleep aborted."));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
