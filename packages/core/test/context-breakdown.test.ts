import { describe, expect, it } from "vitest";
import {
  CONTEXT_SEGMENT_IDS,
  estimateContextBreakdown,
  estimateContextTextTokens,
  isContextBreakdown,
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

  it("attributes skill instructions, skill tools, and loaded skill results to the skills segment", () => {
    const skillCatalog =
      "You have access to Agent Skills.\n\nAvailable skills:\n- deploy: Deploy app.";
    const breakdown = estimateContextBreakdown(
      request({
        instructions: `You are a careful assistant.\n\n${skillCatalog}`,
        chatHistory: [
          { role: "user", content: "Deploy the app and check order 42." },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-skill",
                toolName: "get_skill_instructions",
                output: { type: "text", value: "# Deploy Skill\nRun pnpm deploy." },
              },
              {
                type: "tool-result",
                toolCallId: "call-order",
                toolName: "lookup_order",
                output: { type: "text", value: "Order 42 shipped." },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-ref",
                toolName: "get_skill_reference",
                output: { type: "text", value: "Reference checklist." },
              },
            ],
          },
        ],
        tools: [
          {
            name: "lookup_order",
            description: "Look up an order.",
            parameters: { type: "object" },
          },
          {
            name: "get_skill_instructions",
            description: "Load SKILL.md instructions.",
            parameters: { type: "object" },
          },
          {
            name: "get_skill_reference",
            description: "Read a skill reference.",
            parameters: { type: "object" },
          },
          { name: "search_docs", description: "Search docs.", parameters: { type: "object" } },
        ],
      }),
      {
        mcpToolNames: ["search_docs"],
        skillInstructions: skillCatalog,
        skillToolNames: ["get_skill_instructions", "get_skill_reference"],
      },
    );
    const byId = new Map(breakdown.segments.map((segment) => [segment.id, segment]));

    expect(breakdown.segments.map((segment) => segment.id)).toEqual([
      "instructions",
      "skills",
      "messages",
      "toolResults",
      "tools",
      "mcpTools",
    ]);
    expect(byId.get("instructions")?.characters).toBe("You are a careful assistant.".length);
    expect(byId.get("skills")?.items).toBe(5);
    expect(byId.get("toolResults")?.items).toBe(1);
    expect(byId.get("tools")?.items).toBe(1);
    expect(byId.get("mcpTools")?.items).toBe(1);
  });

  it("omits instructions when the system prompt consists solely of skill instructions", () => {
    const skillCatalog = "You have access to Agent Skills.";
    const breakdown = estimateContextBreakdown(
      request({ instructions: skillCatalog, chatHistory: [{ role: "user", content: "Hi" }] }),
      { skillInstructions: skillCatalog },
    );

    expect(breakdown.segments.map((segment) => segment.id)).toEqual(["skills", "messages"]);
  });

  it("does not fabricate a skills segment when middleware replaces instructions", () => {
    const breakdown = estimateContextBreakdown(
      request({
        instructions: "Overridden prompt.",
        chatHistory: [{ role: "user", content: "Hi" }],
      }),
      { skillInstructions: "You have access to Agent Skills." },
    );

    expect(breakdown.segments.map((segment) => segment.id)).toEqual(["instructions", "messages"]);
    expect(breakdown.segments[0]?.characters).toBe("Overridden prompt.".length);
  });

  it("splits the trailing skill catalog occurrence when user instructions quote it", () => {
    const skillCatalog = "You have access to Agent Skills.";
    const breakdown = estimateContextBreakdown(
      request({
        instructions: `Quoted: "${skillCatalog}"\n\n${skillCatalog}`,
        chatHistory: [{ role: "user", content: "Hi" }],
      }),
      { skillInstructions: skillCatalog },
    );
    const byId = new Map(breakdown.segments.map((segment) => [segment.id, segment]));

    expect(byId.get("instructions")?.characters).toBe(`Quoted: "${skillCatalog}"`.length);
    expect(byId.get("skills")?.characters).toBe(skillCatalog.length);
  });

  it("keeps mcpToolNames precedence consistent across tool definitions and tool results", () => {
    const breakdown = estimateContextBreakdown(
      request({
        chatHistory: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "shared_tool",
                output: { type: "text", value: "result" },
              },
            ],
          },
        ],
        tools: [{ name: "shared_tool", description: "Shared.", parameters: { type: "object" } }],
      }),
      { mcpToolNames: ["shared_tool"], skillToolNames: ["shared_tool"] },
    );

    expect(breakdown.segments.map((segment) => segment.id)).toEqual([
      "instructions",
      "toolResults",
      "mcpTools",
    ]);
  });

  it("validates context breakdown payloads with isContextBreakdown", () => {
    const valid = scaleContextBreakdown(estimateContextBreakdown(request()), 120);
    expect(Object.isFrozen(CONTEXT_SEGMENT_IDS)).toBe(true);
    expect(isContextBreakdown(valid)).toBe(true);
    expect(isContextBreakdown({ ...valid, extra: 1 })).toBe(false);
    expect(isContextBreakdown({ segments: [] })).toBe(false);
    expect(isContextBreakdown({ estimatedTokens: 0 })).toBe(false);
    expect(isContextBreakdown({ segments: [], estimatedTokens: Number.NaN })).toBe(false);
    expect(isContextBreakdown({ segments: [], estimatedTokens: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
    expect(isContextBreakdown({ segments: [], estimatedTokens: 1, reportedInputTokens: -5 })).toBe(
      false,
    );
    expect(
      isContextBreakdown({
        segments: [{ id: "unknown", tokens: 1, characters: 4, items: 1 }],
        estimatedTokens: 1,
      }),
    ).toBe(false);
    expect(
      isContextBreakdown({
        segments: [{ id: "skills", tokens: -1, characters: 4, items: 1 }],
        estimatedTokens: 1,
      }),
    ).toBe(false);
    expect(
      isContextBreakdown({
        segments: [{ id: "skills", tokens: 1, characters: 4.5, items: 1 }],
        estimatedTokens: 1,
      }),
    ).toBe(false);
    expect(
      isContextBreakdown({
        segments: [{ id: "skills", tokens: 1, characters: 4, items: 1.5 }],
        estimatedTokens: 1,
      }),
    ).toBe(false);
    expect(
      isContextBreakdown({
        segments: [
          { id: "skills", tokens: 1, characters: 4, items: 1 },
          { id: "skills", tokens: 2, characters: 8, items: 1 },
        ],
        estimatedTokens: 3,
      }),
    ).toBe(false);
    expect(isContextBreakdown(Object.create({ segments: [], estimatedTokens: 0 }))).toBe(false);
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
