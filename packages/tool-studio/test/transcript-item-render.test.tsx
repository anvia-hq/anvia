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

  it("renders a spinning live timer after the response actions", () => {
    const html = renderToStaticMarkup(
      <TranscriptItem
        entry={{
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "Streaming answer",
          traceId: "trace_live",
        }}
        workingStartedAt={Date.now()}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain("animate-spin");
    expect(html).toContain("Working - 0s");
    expect(html.indexOf("Open trace trace_live")).toBeLessThan(html.indexOf("Working - 0s"));
  });
});
