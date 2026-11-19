import { describe, expect, it } from "vitest";
import {
  estimateContextBreakdown,
  estimateContextTextTokens,
  scaleContextBreakdown,
} from "../src/context";
import type { CompletionRequest } from "../src/completion";

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    instructions: "You are a careful assistant.",
    chatHistory: [
      { role: "user", content: "Where is my order?" },
      { role: "assistant", content: [{ type: "text", text: "Checking." }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookup_order",
            output: { type: "text", value: "Order 42 shipped." },
          },
        ],
      },
    ],
    documents: [],
    tools: [],
    ...overrides,
  };
}

describe("estimateContextBreakdown", () => {
  it("splits instructions, messages, and tool results", () => {
    const breakdown = estimateContextBreakdown(request());
    const byId = new Map(breakdown.segments.map((segment) => [segment.id, segment]));

    expect(byId.get("instructions")?.items).toBe(1);
    expect(byId.get("messages")?.items).toBe(2);
    expect(byId.get("toolResults")?.items).toBe(1);
    expect(byId.has("tools")).toBe(false);
    expect(breakdown.estimatedTokens).toBe(
      breakdown.segments.reduce((total, segment) => total + segment.tokens, 0),
    );
    expect(byId.get("toolResults")?.characters).toBeGreaterThan(0);
  });

  it("reports MCP tools apart from local tools", () => {
    const breakdown = estimateContextBreakdown(
      request({
        tools: [
          {
            name: "lookup_order",
            description: "Look up an order.",
            parameters: { type: "object" },
          },
          { name: "search_docs", description: "Search docs.", parameters: { type: "object" } },
        ],
      }),
      { mcpToolNames: ["search_docs"] },
    );
    const byId = new Map(breakdown.segments.map((segment) => [segment.id, segment]));

    expect(byId.get("tools")?.items).toBe(1);
    expect(byId.get("mcpTools")?.items).toBe(1);
    expect(byId.get("mcpTools")?.tokens).toBeGreaterThan(0);
  });

  it("counts documents, provider tools, and the output schema", () => {
    const breakdown = estimateContextBreakdown(
      request({
        documents: [{ id: "doc-1", text: "Refund policy text.", additionalProps: { a: "b" } }],
        providerTools: [{ kind: "provider", provider: "openai", name: "web_search" }],
        outputSchema: { type: "object", properties: { answer: { type: "string" } } },
      }),
    );
    const ids = breakdown.segments.map((segment) => segment.id);

    expect(ids).toEqual([
      "instructions",
      "messages",
      "toolResults",
      "documents",
      "providerTools",
      "outputSchema",
    ]);
  });

  it("bounds inline base64 media instead of counting its bytes", () => {
    const breakdown = estimateContextBreakdown(
      request({
        chatHistory: [
          {
            role: "user",
            content: [{ type: "image", image: { type: "data", data: "A".repeat(4_000_000) } }],
          },
        ],
      }),
    );
    const messages = breakdown.segments.find((segment) => segment.id === "messages");

    expect(messages?.characters).toBeLessThan(10_000);
    expect(breakdown.estimatedTokens).toBeLessThan(5_000);
  });

  it("uses a supplied token counter", () => {
    const breakdown = estimateContextBreakdown(request({ documents: [{ id: "d", text: "abc" }] }), {
      tokenCounter: () => 7,
    });
    expect(breakdown.segments.find((segment) => segment.id === "documents")?.tokens).toBe(7);
  });

  it("estimates about four characters per token", () => {
    expect(estimateContextTextTokens("")).toBe(0);
    expect(estimateContextTextTokens("abcd")).toBe(1);
    expect(estimateContextTextTokens("abcde")).toBe(2);
  });
});

describe("scaleContextBreakdown", () => {
  it("makes the segments add up to the reported input tokens", () => {
    const breakdown = estimateContextBreakdown(
      request({
        tools: [
          {
            name: "lookup_order",
            description: "Look up an order.",
            parameters: { type: "object" },
          },
        ],
      }),
    );
    const scaled = scaleContextBreakdown(breakdown, 1_234);

    expect(scaled.estimatedTokens).toBe(1_234);
    expect(scaled.reportedInputTokens).toBe(1_234);
    expect(scaled.segments.reduce((total, segment) => total + segment.tokens, 0)).toBe(1_234);
    expect(scaled.segments.map((segment) => segment.id)).toEqual(
      breakdown.segments.map((segment) => segment.id),
    );
    expect(scaled.segments.map((segment) => segment.items)).toEqual(
      breakdown.segments.map((segment) => segment.items),
    );
  });

  it("keeps the largest segment the largest", () => {
    const breakdown = estimateContextBreakdown(request());
    const scaled = scaleContextBreakdown(breakdown, 10_000);
    const largest = (segments: readonly { id: string; tokens: number }[]) =>
      segments.reduce((left, right) => (right.tokens > left.tokens ? right : left)).id;
    expect(largest(scaled.segments)).toBe(largest(breakdown.segments));
  });

  it("leaves the breakdown alone when there is nothing to scale against", () => {
    const breakdown = estimateContextBreakdown(request());
    expect(scaleContextBreakdown(breakdown, 0)).toBe(breakdown);
    expect(scaleContextBreakdown(breakdown, Number.NaN)).toBe(breakdown);
    expect(scaleContextBreakdown(breakdown, -1)).toBe(breakdown);
  });
});
