import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranscriptItem } from "../src/ui/app/modules/playground/transcript-item";

describe("TranscriptItem response actions", () => {
  it("renders assistant copy, metrics, and trace icon actions", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "Answer",
          traceId: "trace_1",
        }}
        metrics={{
          durationMs: 1_200,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Copy response"');
    expect(html).toContain('aria-label="Response metrics"');
    expect(html).toContain('aria-label="Open trace trace_1"');
    expect(html).toContain("Cost");
    expect(html).toContain("Unavailable");
    expect(html).toContain("30 tokens");
    expect(html).toContain("Finished - 1s");
    expect(html.indexOf("Answer")).toBeLessThan(html.indexOf("Copy response"));
    expect(html.indexOf("Copy response")).toBeLessThan(html.indexOf("Response metrics"));
    expect(html.indexOf("Response metrics")).toBeLessThan(html.indexOf("Open trace trace_1"));
    expect(html.indexOf("Open trace trace_1")).toBeLessThan(html.indexOf("Finished - 1s"));
    expect(html).not.toContain("animate-spin");
  });

  it("renders a persisted timer without response text or actions", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: 65_000,
        }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain("Finished - 1m 5s");
    expect(html).not.toContain('aria-label="Copy response"');
    expect(html).not.toContain('aria-label="Response metrics"');
  });

  it("renders a single pending thinking status", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "",
          tone: "pending",
        }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Assistant is thinking"');
    expect(html).toContain("Thinking");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("Working");
  });

  it("renders a non-framed tool call disclosure without a completed indicator", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 4,
          kind: "tool",
          toolName: "search_docs",
          args: '{"query":"typography"}',
          result: "Found 3 results",
        }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Expand search_docs tool call"');
    expect(html).toContain("search_docs");
    expect(html).not.toContain("Completed");
    expect(html).not.toContain("size-1.5 rounded-full");
    expect(html).not.toContain("Show");
    expect(html).not.toContain("Hide");
    expect(html).not.toContain("shadow-black/20");
  });

  it("renders expanded tool call payloads without frames", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 5,
          kind: "tool",
          toolName: "write_file",
          args: '{"path":"notes.md"}',
          approval: {
            id: "approval-1",
            status: "pending",
            requestedAt: "2026-08-12T00:00:00.000Z",
          },
        }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Collapse write_file tool call"');
    expect(html).toContain("Input");
    expect(html).not.toContain("border-l border-border/70");
    expect(html).not.toContain("rounded-lg border border-border/80 bg-background/70");
  });
});
