import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudioConfig } from "../src/types";
import { PlaygroundPage } from "../src/ui/app/modules/playground/playground-page";

const agent: StudioConfig["agents"][number] = { id: "support", quickPrompts: [] };

describe("PlaygroundPage run action", () => {
  it("renders send, preparing, and stop states", () => {
    const idleHtml = render();
    expect(idleHtml).not.toContain("bg-gradient-to-t");
    expect(idleHtml).toContain("max-w-200");
    expect(idleHtml).not.toContain("max-w-235");
    expect(idleHtml).toContain("gap-1.5");
    expect(idleHtml).toContain("p-1.5");
    expect(idleHtml).toContain("min-h-9");
    expect(idleHtml).toContain("border-0 bg-muted px-2.5");
    expect(idleHtml).not.toContain("border-0 bg-muted/50 px-2.5");
    expect(idleHtml).not.toContain("min-h-16 min-w-0 resize-none");
    const idleButton = runAction(idleHtml);
    expect(idleButton).toContain('aria-label="Send message"');
    expect(idleButton).toContain('type="submit"');
    expect(idleButton).toContain("size-9");
    expect(idleButton).toContain("rounded-lg");
    expect(idleButton).not.toContain("rounded-full");
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

    const attachmentButton = buttonWithLabel(idleHtml, "Attach image or document");
    expect(attachmentButton).toContain("size-9");
    expect(attachmentButton).toContain("rounded-lg");
    expect(attachmentButton).toContain("border-border");
    expect(attachmentButton).toContain("bg-transparent");
    expect(attachmentButton).not.toContain("border-0");
  });

  it("does not render the removed working indicator", () => {
    const html = render({
      hasMessages: true,
      messages: [
        { entryId: 1, kind: "message", role: "user", text: "Investigate" },
        { entryId: 2, kind: "reasoning", text: "Checking" },
      ],
    });

    expect(html).not.toContain("Working");
    expect(html).not.toContain("animate-spin");
  });

  it("renders session rows without chat icons", () => {
    const html = render({
      selectedSessionId: "session-1",
      allSessions: [
        {
          id: "session-1",
          agentId: "support",
          title: "Font review",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
          messageCount: 1,
        },
      ],
    });
    const sessionButton = buttons(html).find((button) => button.includes(">Font review</span>"));

    expect(sessionButton).toBeDefined();
    expect(sessionButton).not.toContain("<svg");
    expect(sessionButton).toContain("hover:bg-sidebar-accent");
  });

  it("replaces the sessions sidebar with the clean browser workspace", () => {
    const html = render({
      browserWorkspace: {
        sandboxRef: "sandbox_ref",
        view: { id: "desktop", label: "Browser", protocol: "novnc" },
      },
      browserWorkspaceOpen: true,
    });

    expect(html).toContain('aria-label="Browser workspace"');
    expect(html).toContain('aria-label="Live browser desktop"');
    expect(html).not.toContain('aria-label="Sessions"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("noVNC");
    expect(html).not.toContain("Password");
    expect(html).not.toContain("max-lg:hidden");
  });

  it("keeps a closed browser workspace available to restore", () => {
    const html = render({
      browserWorkspace: {
        sandboxRef: "sandbox_ref",
        view: { id: "desktop", label: "Browser", protocol: "novnc" },
      },
      browserWorkspaceOpen: false,
    });

    expect(html).toContain('aria-label="Open browser workspace"');
    expect(html).toContain('aria-label="Sessions"');
    expect(html).not.toContain('aria-label="Browser workspace"');
  });

  it("renders generic completion model controls with a provider default", () => {
    const html = render({
      selectedAgentModels: [
        {
          id: "reasoning-model",
          ref: "test:reasoning-model",
          providerId: "test",
          controls: {
            reasoningEffort: {
              type: "select",
              label: "Reasoning effort",
              options: ["low", "high"],
              defaultValue: "high",
            },
          },
        },
      ],
      selectedModelRef: "test:reasoning-model",
    });

    expect(html).toContain('aria-label="Reasoning effort"');
  });
});

function render(overrides: Partial<Parameters<typeof PlaygroundPage>[0]> = {}): string {
  return renderToStaticMarkup(
    <PlaygroundPage
      agents={[agent]}
      allSessions={[]}
      answeringQuestions={new Set()}
      attachments={[]}
      browserWorkspace={undefined}
      browserWorkspaceOpen={false}
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
      selectedControls={{}}
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
      onCloseBrowserWorkspace={vi.fn()}
      onDeleteSession={vi.fn()}
      onError={vi.fn()}
      onLoadSession={vi.fn()}
      onOpenBrowserWorkspace={vi.fn()}
      onOpenTrace={vi.fn()}
      onPromptChange={vi.fn()}
      onPromptKeyDown={vi.fn()}
      onQuestionAnswer={vi.fn()}
      onRemovePromptAttachment={vi.fn()}
      onRunPrompt={vi.fn()}
      onStopPrompt={vi.fn()}
      onSelectAgent={vi.fn()}
      onSelectControl={vi.fn()}
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

function buttonWithLabel(html: string, label: string): string {
  const matched = html.match(
    new RegExp(`<button[^>]+aria-label="${label}"[^>]*>[\\s\\S]*?</button>`),
  );
  if (matched === null) {
    throw new Error(`${label} button not found`);
  }
  return matched[0];
}

function buttons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}
