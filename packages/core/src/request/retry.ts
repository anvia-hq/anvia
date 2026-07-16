import type { JsonValue } from "../completion";

export type CompletionRetryContext = {
  error: unknown;
  attempt: number;
  maxAttempts: number;
  turn: number;
  streaming: boolean;
};

export type CompletionRetryOptions = {
  maxAttempts?: number | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  shouldRetry?: ((context: CompletionRetryContext) => boolean) | undefined;
};

export type ResolvedCompletionRetryOptions = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: (context: CompletionRetryContext) => boolean;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);
const RETRYABLE_NUMERIC_ERROR_CODES = new Set([4, 8, 14]);
const RETRYABLE_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "TimeoutError",
]);
const RETRYABLE_ERROR_CODES = new Set([
  "DEADLINE_EXCEEDED",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function resolveCompletionRetryOptions(
  options: CompletionRetryOptions,
): ResolvedCompletionRetryOptions {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Completion retry maxAttempts must be a positive integer.");
  }
  assertDelay(initialDelayMs, "initialDelayMs");
  assertDelay(maxDelayMs, "maxDelayMs");
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError(
      "Completion retry maxDelayMs must be greater than or equal to initialDelayMs.",
    );
  }
  if (options.shouldRetry !== undefined && typeof options.shouldRetry !== "function") {
    throw new TypeError("Completion retry shouldRetry must be a function.");
  }

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    shouldRetry: options.shouldRetry ?? defaultShouldRetry,
  };
}

export function completionRetryDelayMs(
  options: ResolvedCompletionRetryOptions,
  failedAttempt: number,
): number {
  const exponentialDelay = options.initialDelayMs * 2 ** (failedAttempt - 1);
  const cappedDelay = Math.min(options.maxDelayMs, exponentialDelay);
  return Math.random() * cappedDelay;
}

export function completionRetryErrorAttributes(
  error: unknown,
): Record<string, JsonValue | undefined> {
  const errors = errorChain(error);
  const errorName = errors
    .map((candidate) => stringProperty(candidate, "name"))
    .find((value) => value !== undefined);
  const statusCode = firstStatusCode(errors);
  const errorCode = errors
    .map((candidate) => errorCodeProperty(candidate))
    .find((value) => value !== undefined);

  return {
    errorName,
    statusCode,
    errorCode,
  };
}

export async function waitForCompletionRetry(delayMs: number): Promise<void> {
  if (delayMs === 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function defaultShouldRetry(context: CompletionRetryContext): boolean {
  const errors = errorChain(context.error);
  if (errors.some((error) => stringProperty(error, "name") === "AbortError")) {
    return false;
  }

  const statusCode = firstStatusCode(errors);
  if (statusCode !== undefined) {
    return RETRYABLE_STATUS_CODES.has(statusCode) || (statusCode >= 500 && statusCode <= 599);
  }

  return errors.some((error) => {
    const name = stringProperty(error, "name");
    if (name !== undefined && RETRYABLE_ERROR_NAMES.has(name)) {
      return true;
    }
    const code = stringProperty(error, "code")?.toUpperCase();
    if (code !== undefined && RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }
    const numericCode = numberProperty(error, "code");
    return numericCode !== undefined && RETRYABLE_NUMERIC_ERROR_CODES.has(numericCode);
  });
}

function firstStatusCode(errors: Record<string, unknown>[]): number | undefined {
  for (const error of errors) {
    const status = numberProperty(error, "status") ?? numberProperty(error, "statusCode");
    if (status !== undefined) {
      return status;
    }
    const code = numberProperty(error, "code");
    if (code !== undefined && code >= 100 && code <= 599) {
      return code;
    }
  }
  return undefined;
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const errors: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  let current = error;
  while (isObject(current) && !seen.has(current)) {
    seen.add(current);
    errors.push(current);
    current = property(current, "cause");
  }
  return errors;
}

function assertDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `Completion retry ${name} must be between 0 and ${MAX_TIMER_DELAY_MS} milliseconds.`,
    );
  }
}

function numberProperty(value: Record<string, unknown>, name: string): number | undefined {
  const candidate = property(value, name);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function stringProperty(value: Record<string, unknown>, name: string): string | undefined {
  const candidate = property(value, name);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function errorCodeProperty(value: Record<string, unknown>): string | number | undefined {
  return stringProperty(value, "code") ?? numberProperty(value, "code");
}

function property(value: Record<string, unknown>, name: string): unknown {
  try {
    return value[name];
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
