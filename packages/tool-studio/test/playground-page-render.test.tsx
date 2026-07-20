import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudioConfig } from "../src/types";
import { PlaygroundPage } from "../src/ui/app/modules/playground/playground-page";

const agent: StudioConfig["agents"][number] = { id: "support", quickPrompts: [] };

describe("PlaygroundPage run action", () => {
  it("renders send, preparing, and stop states", () => {
    const idleButton = runAction(render());
    expect(idleButton).toContain('aria-label="Send message"');
    expect(idleButton).toContain('type="submit"');
    expect(idleButton).not.toMatch(/\sdisabled(?:=""|(?=[\s>]))/);

    const preparingButton = runAction(render({ runState: "running" }));
    expect(preparingButton).toContain('aria-label="Running"');
    expect(preparingButton).toContain('type="submit"');
    expect(preparingButton).toMatch(/\sdisabled(?:=""|(?=[\s>]))/);

    const stopButton = runAction(render({ isStreaming: true, runState: "running" }));
    expect(stopButton).toContain('aria-label="Stop generating"');
    expect(stopButton).toContain('type="button"');
    expect(stopButton).toContain('fill="currentColor"');
    expect(stopButton).not.toMatch(/\sdisabled(?:=""|(?=[\s>]))/);
  });

  it("renders a live working timer when the active turn has no assistant response", () => {
    const html = render({
      hasMessages: true,
      messages: [
        { entryId: 1, kind: "message", role: "user", text: "Investigate" },
        { entryId: 2, kind: "reasoning", text: "Checking" },
      ],
      workingStartedAt: Date.now() - 65_000,
    });

    expect(html).toContain("Working - 1m 5s");
    expect(html).toContain("animate-spin");
  });
});

function render(overrides: Partial<Parameters<typeof PlaygroundPage>[0]> = {}): string {
  return renderToStaticMarkup(
    <PlaygroundPage
      agents={[agent]}
      allSessions={[]}
      answeringQuestions={new Set()}
      attachments={[]}
      decidingApprovals={new Set()}
      hasMessages={false}
      isStreaming={false}
      messages={[]}
      prompt="Hello"
      runState="idle"
      selectedAgent={agent}
      selectedAgentId={agent.id}
      selectedAgentModels={[]}
      selectedAgentQuickPrompts={[]}
      selectedModelRef=""
      selectedSessionId=""
      sessionLogs={[]}
      sessionTraceSummaries={[]}
      attachmentInputRef={createRef<HTMLInputElement>()}
      promptRef={createRef<HTMLTextAreaElement>()}
      transcriptScrollerRef={createRef<HTMLElement>()}
      transcriptResetKey={0}
      onAddPromptAttachments={vi.fn()}
      onApprovalDecision={vi.fn()}
      onDeleteSession={vi.fn()}
      onLoadSession={vi.fn()}
      onOpenTrace={vi.fn()}
      onPromptChange={vi.fn()}
      onPromptKeyDown={vi.fn()}
      onQuestionAnswer={vi.fn()}
      onRemovePromptAttachment={vi.fn()}
      onRunPrompt={vi.fn()}
      onStopPrompt={vi.fn()}
      onSelectAgent={vi.fn()}
      onSelectModel={vi.fn()}
      onTranscriptScroll={vi.fn()}
      {...overrides}
    />,
  );
}

function runAction(html: string): string {
  const matched = html.match(
    /<button[^>]+aria-label="(?:Send message|Running|Stop generating)"[^>]*>[\s\S]*?<\/button>/,
  );
  if (matched === null) {
    throw new Error("Run action button not found");
  }
  return matched[0];
}
