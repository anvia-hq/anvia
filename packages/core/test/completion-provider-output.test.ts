import { describe, expect, it } from "vitest";
import type { CompletionProviderOutputErrorOptions } from "../src/completion/provider-output-error";
import {
  assertCompletionResponseIntegrity,
  CompletionProviderOutputError,
} from "../src/completion/provider-output-error";
import type { CompletionResponse } from "../src/completion/types";
import { Usage } from "../src/completion/types";
import { AssistantContent } from "./helpers/imports";

describe("completion provider output integrity", () => {
  it("does not retain or expose raw tool arguments", () => {
    const secret = "secret-token-in-provider-output";
    const error = new CompletionProviderOutputError({
      kind: "malformed-tool-arguments",
      toolCallId: `tool_0\n${"x".repeat(200)}`,
    });

    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("\n");
    expect(error.message.length).toBeLessThan(256);
    expect(error).not.toHaveProperty("arguments");
    expect(error).not.toHaveProperty("cause");
  });

  it("copies validated usage instead of retaining caller-owned metadata", () => {
    const usage = {
      ...Usage.empty(),
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      details: { reasoningTokens: 1 },
    };
    const error = new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      usage,
    });

    usage.details.reasoningTokens = 9;
    expect(error.usage?.details).toEqual({ reasoningTokens: 1 });
  });

  it("rejects invalid constructor data", () => {
    expect(() => new CompletionProviderOutputError({ kind: "future-kind" } as never)).toThrow(
      "kind is invalid",
    );
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          toolCallId: "  ",
        }),
    ).toThrow("toolCallId must be a non-empty string");
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          usage: { ...Usage.empty(), totalTokens: Number.POSITIVE_INFINITY },
        }),
    ).toThrow("finite token counts");
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "truncated-tool-call",
          finishReason: "stop",
        } as never),
    ).toThrow('truncated-tool-call requires "length"');
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "filtered-tool-call",
          finishReason: "length",
        } as never),
    ).toThrow('filtered-tool-call requires "content-filter"');
    expect(
      () => new CompletionProviderOutputError({ kind: "truncated-tool-call" } as never),
    ).toThrow('truncated-tool-call requires "length"');
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "malformed-tool-arguments",
          finishReason: "content-filter",
        } as never),
    ).toThrow('finishReason "content-filter" requires filtered-tool-call');
    expect(
      () =>
        new CompletionProviderOutputError({
          kind: "invalid-tool-call",
          finishReason: "length",
        } as never),
    ).toThrow('finishReason "length" requires truncated-tool-call');

    // @ts-expect-error Truncation can only carry the normalized length finish reason.
    const contradictory: CompletionProviderOutputErrorOptions = {
      kind: "truncated-tool-call",
      finishReason: "stop",
    };
    expect(contradictory.finishReason).toBe("stop");
  });

  it("rejects contradictory finish reasons and duplicate identities", () => {
    const truncated = response([
      AssistantContent.toolCall("tool_0", "lookup", { query: "anvia" }, "call_0"),
    ]);
    truncated.finishReason = "length";
    expect(() => assertCompletionResponseIntegrity({ response: truncated })).toThrowError(
      expect.objectContaining({ kind: "truncated-tool-call" }),
    );

    const missingCalls = response([]);
    missingCalls.finishReason = "tool-calls";
    expect(() => assertCompletionResponseIntegrity({ response: missingCalls })).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call" }),
    );

    const duplicate = response([
      AssistantContent.toolCall("tool_0", "lookup", { query: "one" }, "call_0"),
      AssistantContent.toolCall("tool_0", "lookup", { query: "two" }, "call_1"),
    ]);
    expect(() => assertCompletionResponseIntegrity({ response: duplicate })).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "tool_0" }),
    );

    const duplicateProviderCallId = response([
      AssistantContent.toolCall("tool_0", "lookup", { query: "one" }, "call_0"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "two" }, "call_0"),
    ]);
    expect(() =>
      assertCompletionResponseIntegrity({ response: duplicateProviderCallId }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "tool_1" }));

    const unknownFinish = response([
      AssistantContent.toolCall("tool_0", "lookup", { query: "anvia" }, "call_0"),
    ]);
    unknownFinish.finishReason = "future" as never;
    expect(() => assertCompletionResponseIntegrity({ response: unknownFinish })).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call" }),
    );
  });

  it("rejects runtime values outside the JsonValue contract", () => {
    const invalid = response([
      AssistantContent.toolCall("tool_0", "lookup", {
        value: Number.POSITIVE_INFINITY,
      }),
    ]);

    expect(() => assertCompletionResponseIntegrity({ response: invalid })).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-arguments", toolCallId: "tool_0" }),
    );
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return { choice, usage: Usage.empty(), rawResponse: {} };
}
