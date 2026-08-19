import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
  CompletionProviderOutputError,
} from "../src/completion";
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

  it("retries only structurally identified retryable provider-output failures", () => {
    const shouldRetry = resolveRetryOptions({}).shouldRetry;
    const context = (error: unknown) => ({
      error,
      attempt: 1,
      maxAttempts: 3,
      streaming: false,
    });

    expect(
      shouldRetry(
        context(
          new CompletionProviderOutputError({
            kind: "malformed-tool-arguments",
            toolCallId: "tool_0",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      shouldRetry(
        context({
          name: "CompletionProviderOutputError",
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "invalid-tool-arguments",
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetry(
        context({
          name: "CompletionProviderOutputError",
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "filtered-tool-call",
          finishReason: "content-filter",
        }),
      ),
    ).toBe(false);
    expect(
      shouldRetry(
        context(
          Object.assign(
            new Error("wrapped", {
              cause: {
                name: "CompletionProviderOutputError",
                code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
                kind: "filtered-tool-call",
                finishReason: "content-filter",
              },
            }),
            { status: 503 },
          ),
        ),
      ),
    ).toBe(false);
    expect(
      shouldRetry(
        context({
          name: "CompletionProviderOutputError",
          kind: "malformed-tool-arguments",
        }),
      ),
    ).toBe(false);
    expect(
      shouldRetry(
        context({
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "malformed-tool-arguments",
        }),
      ),
    ).toBe(false);
    expect(shouldRetry(context(new SyntaxError("Unexpected end of JSON input")))).toBe(false);
    expect(
      shouldRetry(
        context({
          name: "CompletionProviderOutputError",
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "malformed-tool-arguments",
          finishReason: "content-filter",
          status: 503,
        }),
      ),
    ).toBe(false);
    expect(
      shouldRetry(
        context({
          name: "CompletionProviderOutputError",
          code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
          kind: "invalid-tool-call",
          finishReason: "length",
          status: 503,
        }),
      ),
    ).toBe(false);
    for (const finishReason of ["future", "", 42]) {
      expect(
        shouldRetry(
          context({
            name: "CompletionProviderOutputError",
            code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
            kind: "malformed-tool-arguments",
            finishReason,
            status: 503,
          }),
        ),
      ).toBe(false);
    }
  });

  it("does not retry content-filtered structured output", () => {
    const shouldRetry = resolveRetryOptions({}).shouldRetry;

    expect(
      shouldRetry({
        error: { name: "AgentStructuredOutputError", phase: "content-filter" },
        attempt: 1,
        maxAttempts: 3,
        streaming: false,
      }),
    ).toBe(false);
  });
});
