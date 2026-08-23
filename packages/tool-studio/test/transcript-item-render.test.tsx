// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptItem } from "../src/ui/app/modules/playground/transcript-item";

describe("TranscriptItem response actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(element: ReactNode): string {
    act(() => root.render(element));
    return container.innerHTML;
  }

  it("renders assistant copy, metrics, and trace icon actions", () => {
    const html = render(
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
    const html = render(
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
    const html = render(
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

  it("renders a compact tool disclosure with a framed action icon", () => {
    const html = render(
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
    expect(html).toContain('data-entry-kind="tool"');
    expect(html).toContain('data-tool-icon="action"');
    expect(html).toContain("size-6 shrink-0 place-items-center rounded-md border");
    expect(html).toContain("font-mono text-sm");
    expect(html).not.toContain("Completed");
    expect(html).not.toContain("size-1.5 rounded-full");
    expect(html).not.toContain("Show");
    expect(html).not.toContain("Hide");
    expect(html).not.toContain("shadow-black/20");

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand search_docs tool call"]',
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Input");
    expect(container.textContent).toContain("Output");
  });

  it("renders expanded tool call payloads without frames", () => {
    const html = render(
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

  it.each([
    ["rejected", "Rejected"],
    ["timed_out", "Timed out"],
  ] as const)("renders terminal %s approvals without a running status", (status, label) => {
    const html = render(
      <TranscriptItem
        entry={{
          entryId: 6,
          kind: "tool",
          toolName: "write_file",
          approval: {
            id: "approval-1",
            status,
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

    expect(html).toContain(label);
    expect(html).not.toContain("Running");
  });

  it("does not advertise disclosure for a payload-less tool call", () => {
    const html = render(
      <TranscriptItem
        entry={{ entryId: 7, kind: "tool", toolName: "lookup" }}
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).not.toContain("Running");
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand lookup tool call"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("shows running only for the live tool call", () => {
    const html = render(
      <TranscriptItem
        entry={{ entryId: 8, kind: "tool", toolName: "browser_navigate" }}
        live
        decidingApprovals={new Set()}
        answeringQuestions={new Set()}
        onApprovalDecision={vi.fn()}
        onQuestionAnswer={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );

    expect(html).toContain("Running");
    expect(html).toContain("animate-pulse");
  });
});
