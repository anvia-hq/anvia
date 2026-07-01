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
  });
});
