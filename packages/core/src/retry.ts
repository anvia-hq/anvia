import type { JsonObject, Usage } from "./completion/types";
import { abortError, isAbortError, waitForAbortableDelay } from "./internal/abort";

export type RetryContext = {
  error: unknown;
  attempt: number;
  maxAttempts: number;
  streaming: boolean;
  turn?: number | undefined;
};

export type RetryOptions = {
  maxAttempts?: number | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  shouldRetry?: ((context: RetryContext) => boolean) | undefined;
};

export type RetrySetting = RetryOptions | false;

export type ResolvedRetryOptions = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: (context: RetryContext) => boolean;
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
const RETRYABLE_STRUCTURED_OUTPUT_PHASES = new Set(["truncated", "parse", "schema"]);
const RETRYABLE_PROVIDER_OUTPUT_KINDS = new Set([
  "malformed-tool-arguments",
  "invalid-tool-arguments",
  "invalid-stream-event",
  "incomplete-stream",
  "incomplete-tool-call",
  "invalid-tool-call",
  "truncated-tool-call",
]);
const PROVIDER_OUTPUT_KINDS = new Set([
  ...RETRYABLE_PROVIDER_OUTPUT_KINDS,
  "filtered-tool-call",
  "invalid-response",
]);
const PROVIDER_OUTPUT_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "other",
]);
const COMPLETION_PROVIDER_OUTPUT_ERROR_CODE = "ANVIA_COMPLETION_PROVIDER_OUTPUT";
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

export function resolveRetryOptions(options: RetryOptions): ResolvedRetryOptions {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Retry maxAttempts must be a positive integer.");
  }
  assertDelay(initialDelayMs, "initialDelayMs");
  assertDelay(maxDelayMs, "maxDelayMs");
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError("Retry maxDelayMs must be greater than or equal to initialDelayMs.");
  }
  if (options.shouldRetry !== undefined && typeof options.shouldRetry !== "function") {
    throw new TypeError("Retry shouldRetry must be a function.");
  }

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    shouldRetry: options.shouldRetry ?? defaultShouldRetry,
  };
}

export function retryDelayMs(options: ResolvedRetryOptions, failedAttempt: number): number {
  const exponentialDelay = options.initialDelayMs * 2 ** (failedAttempt - 1);
  const cappedDelay = Math.min(options.maxDelayMs, exponentialDelay);
  return Math.random() * cappedDelay;
}

export function retryErrorAttributes(error: unknown): JsonObject {
  const errors = errorChain(error);
  const errorName = errors
    .map((candidate) => stringProperty(candidate, "name"))
    .find((value) => value !== undefined);
  const statusCode = firstStatusCode(errors);
  const errorCode = errors
    .map((candidate) => errorCodeProperty(candidate))
    .find((value) => value !== undefined);

  const attributes: JsonObject = {};
  if (errorName !== undefined) attributes.errorName = errorName;
  if (statusCode !== undefined) attributes.statusCode = statusCode;
  if (errorCode !== undefined) attributes.errorCode = errorCode;
  const providerOutputError = errors.find(isCompletionProviderOutputErrorRecord);
  if (providerOutputError !== undefined) {
    const kind = stringProperty(providerOutputError, "kind");
    if (kind !== undefined) attributes.providerOutputKind = kind;
    const finishReason = stringProperty(providerOutputError, "finishReason");
    if (finishReason !== undefined) attributes.finishReason = finishReason;
    const usage = usageProperty(providerOutputError);
    if (usage !== undefined) attributes.attemptUsage = usageEventValue(usage);
  }
  return attributes;
}

export function completionProviderOutputErrorUsage(error: unknown): Usage | undefined {
  for (const candidate of errorChain(error)) {
    if (!isCompletionProviderOutputErrorRecord(candidate)) continue;
    const usage = usageProperty(candidate);
    if (usage !== undefined) return usage;
  }
  return undefined;
}

export async function waitForRetry(
  delayMs: number,
  abortSignal?: AbortSignal | undefined,
): Promise<void> {
  await waitForAbortableDelay(delayMs, abortSignal);
}

export function retryOptionsForFailure(
  options: ResolvedRetryOptions | undefined,
  context: Omit<RetryContext, "maxAttempts">,
): ResolvedRetryOptions | undefined {
  if (isAbortError(context.error)) return undefined;
  if (options === undefined || context.attempt >= options.maxAttempts) return undefined;
  return options.shouldRetry({ ...context, maxAttempts: options.maxAttempts })
    ? options
    : undefined;
}

export async function runWithRetries<T>(
  operation: () => Promise<T>,
  options: ResolvedRetryOptions | undefined,
  context: {
    streaming: boolean;
    turn?: number | undefined;
    abortSignal?: AbortSignal | undefined;
  },
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (context.abortSignal?.aborted === true) {
        throw abortError(context.abortSignal.reason);
      }
      const retryOptions = retryOptionsForFailure(options, { error, attempt, ...context });
      if (retryOptions === undefined) throw error;
      await waitForRetry(retryDelayMs(retryOptions, attempt), context.abortSignal);
      attempt += 1;
    }
  }
}

function defaultShouldRetry(context: RetryContext): boolean {
  const errors = errorChain(context.error);
  if (isAbortError(context.error)) return false;

  const providerOutputErrorMarker = errors.find(isCompletionProviderOutputErrorMarker);
  if (providerOutputErrorMarker !== undefined) {
    if (!isCompletionProviderOutputErrorRecord(providerOutputErrorMarker)) return false;
    const kind = stringProperty(providerOutputErrorMarker, "kind");
    return kind !== undefined && RETRYABLE_PROVIDER_OUTPUT_KINDS.has(kind);
  }

  const structuredOutputError = errors.find(
    (error) => stringProperty(error, "name") === "AgentStructuredOutputError",
  );
  if (structuredOutputError !== undefined) {
    const phase = stringProperty(structuredOutputError, "phase");
    return phase !== undefined && RETRYABLE_STRUCTURED_OUTPUT_PHASES.has(phase);
  }

  const statusCode = firstStatusCode(errors);
  if (statusCode !== undefined) {
    return RETRYABLE_STATUS_CODES.has(statusCode) || (statusCode >= 500 && statusCode <= 599);
  }

  return errors.some((error) => {
    const name = stringProperty(error, "name");
    if (name !== undefined && RETRYABLE_ERROR_NAMES.has(name)) return true;
    const code = stringProperty(error, "code")?.toUpperCase();
    if (code !== undefined && RETRYABLE_ERROR_CODES.has(code)) return true;
    const numericCode = numberProperty(error, "code");
    return numericCode !== undefined && RETRYABLE_NUMERIC_ERROR_CODES.has(numericCode);
  });
}

function isCompletionProviderOutputErrorRecord(error: Record<string, unknown>): boolean {
  const kind = stringProperty(error, "kind");
  return (
    isCompletionProviderOutputErrorMarker(error) &&
    kind !== undefined &&
    PROVIDER_OUTPUT_KINDS.has(kind) &&
    hasConsistentProviderOutputFinish(error, kind)
  );
}

function isCompletionProviderOutputErrorMarker(error: Record<string, unknown>): boolean {
  return (
    stringProperty(error, "name") === "CompletionProviderOutputError" &&
    stringProperty(error, "code") === COMPLETION_PROVIDER_OUTPUT_ERROR_CODE
  );
}

function hasConsistentProviderOutputFinish(error: Record<string, unknown>, kind: string): boolean {
  const rawFinishReason = property(error, "finishReason");
  if (
    rawFinishReason !== undefined &&
    (typeof rawFinishReason !== "string" || !PROVIDER_OUTPUT_FINISH_REASONS.has(rawFinishReason))
  ) {
    return false;
  }
  const finishReason = rawFinishReason as string | undefined;
  if (kind === "truncated-tool-call") return finishReason === "length";
  if (kind === "filtered-tool-call") return finishReason === "content-filter";
  return finishReason !== "length" && finishReason !== "content-filter";
}

function usageProperty(value: Record<string, unknown>): Usage | undefined {
  const usage = property(value, "usage");
  if (!isObject(usage)) return undefined;
  const inputTokens = nonnegativeNumberProperty(usage, "inputTokens");
  const outputTokens = nonnegativeNumberProperty(usage, "outputTokens");
  const totalTokens = nonnegativeNumberProperty(usage, "totalTokens");
  const cachedInputTokens = nonnegativeNumberProperty(usage, "cachedInputTokens");
  const cacheCreationInputTokens = nonnegativeNumberProperty(usage, "cacheCreationInputTokens");
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined ||
    cachedInputTokens === undefined ||
    cacheCreationInputTokens === undefined
  ) {
    return undefined;
  }
  const result: Usage = {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
  };
  const details = property(usage, "details");
  if (details !== undefined) {
    if (!isObject(details)) return undefined;
    const copiedDetails: Record<string, number> = {};
    for (const [key, detail] of Object.entries(details)) {
      if (typeof detail !== "number" || !Number.isFinite(detail) || detail < 0) return undefined;
      copiedDetails[key] = detail;
    }
    result.details = copiedDetails;
  }
  return result;
}

function usageEventValue(usage: Usage): JsonObject {
  const value: JsonObject = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
  if (usage.details !== undefined) value.details = { ...usage.details };
  return value;
}

function firstStatusCode(errors: Record<string, unknown>[]): number | undefined {
  for (const error of errors) {
    const status = numberProperty(error, "status");
    if (status !== undefined && status >= 100 && status <= 599) return status;
    const statusCode = numberProperty(error, "statusCode");
    if (statusCode !== undefined && statusCode >= 100 && statusCode <= 599) return statusCode;
    const code = numberProperty(error, "code");
    if (code !== undefined && code >= 100 && code <= 599) return code;
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
    throw new RangeError(`Retry ${name} must be between 0 and ${MAX_TIMER_DELAY_MS} milliseconds.`);
  }
}

function numberProperty(value: Record<string, unknown>, name: string): number | undefined {
  const candidate = property(value, name);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function nonnegativeNumberProperty(
  value: Record<string, unknown>,
  name: string,
): number | undefined {
  const candidate = numberProperty(value, name);
  return candidate !== undefined && candidate >= 0 ? candidate : undefined;
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
