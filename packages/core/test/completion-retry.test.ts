import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRetryOptions, retryDelayMs } from "../src/retry";

describe("retry policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses capped exponential backoff with full jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const options = resolveRetryOptions({
      initialDelayMs: 100,
      maxDelayMs: 250,
    });

    expect(retryDelayMs(options, 1)).toBe(50);
    expect(retryDelayMs(options, 2)).toBe(100);
    expect(retryDelayMs(options, 3)).toBe(125);
    expect(retryDelayMs(options, 4)).toBe(125);
  });

  it("classifies HTTP, nested network, gRPC, and abort errors conservatively", () => {
    const shouldRetry = resolveRetryOptions({}).shouldRetry;
    const context = (error: unknown) => ({
      error,
      attempt: 1,
      maxAttempts: 3,
      turn: 1,
      streaming: false,
    });

    expect(shouldRetry(context({ status: 503 }))).toBe(true);
    expect(shouldRetry(context({ status: 404 }))).toBe(false);
    expect(shouldRetry(context(new Error("outer", { cause: { code: "ECONNRESET" } })))).toBe(true);
    expect(shouldRetry(context({ code: 14 }))).toBe(true);
    expect(shouldRetry(context({ name: "AbortError", status: 503 }))).toBe(false);
    expect(shouldRetry(context(new Error("unknown")))).toBe(false);
  });
});
