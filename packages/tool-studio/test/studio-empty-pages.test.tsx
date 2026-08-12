import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentsPage } from "../src/ui/app/modules/agents/agents-page";
import { McpsPage } from "../src/ui/app/modules/mcps/mcps-page";
import { MemoryPage } from "../src/ui/app/modules/memory/memory-page";
import { PipelinesPage } from "../src/ui/app/modules/pipelines/pipelines-page";
import { SandboxesPage } from "../src/ui/app/modules/sandboxes/sandboxes-page";
import { SessionsPage } from "../src/ui/app/modules/sessions/sessions-page";
import { StatusPage } from "../src/ui/app/modules/status/status-page";
import { ToolsPage } from "../src/ui/app/modules/tools/tools-page";

describe("Studio full-page empty states", () => {
  it.each([
    ["Studio", "No agents", renderAgents],
    ["Tools", "No tools", renderTools],
    ["MCPs", "No MCPs", renderMcps],
    ["Memory", "No memory sources", renderMemory],
    ["Status", "Status unavailable", renderStatus],
    ["Sandboxes", "No live sandboxes detected", renderSandboxes],
    ["Sessions", "No sessions", renderSessions],
    ["Pipelines", "No pipelines", renderPipelines],
  ] satisfies Array<
    [string, string, () => string]
  >)("centers the %s empty state in the available page area", (_, emptyTitle, renderPage) => {
    const html = renderPage();

    expect(emptyStateCount(html)).toBe(1);
    expect(html).toContain(emptyTitle);
    expect(html).toContain('data-size="default"');
    expect(emptyStateClasses(html)).toEqual(expect.arrayContaining(["h-full", "min-h-64"]));
    expect(html).not.toContain("min-h-80 place-items-center");
  });

  it("does not leave the Sessions table header above an empty state", () => {
    const html = renderSessions();

    expect(html).toContain("No sessions");
    expect(html).not.toContain(">Messages<");
    expect(html).not.toContain(">Updated<");
  });

  it("keeps the Sessions table header when rows exist", () => {
    const html = renderToStaticMarkup(
      <SessionsPage
        agents={[{ id: "support", name: "Support", quickPrompts: [] }]}
        sessions={[
          {
            id: "session_1",
            agentId: "support",
            title: "Support chat",
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:01:00.000Z",
            messageCount: 2,
          },
        ]}
        sessionsEnabled
        sessionLoadState="idle"
        selectedSessionId=""
        onDeleteSession={vi.fn()}
        onOpenSession={vi.fn()}
        onViewSessionTracing={vi.fn()}
      />,
    );

    expect(emptyStateCount(html)).toBe(0);
    expect(html).toContain(">Messages<");
    expect(html).toContain(">Updated<");
    expect(html).toContain("Support chat");
  });
});

function renderAgents(): string {
  return renderToStaticMarkup(<AgentsPage agents={[]} selectedAgentId="" />);
}

function renderTools(): string {
  return renderToStaticMarkup(
    <ToolsPage
      agents={[]}
      enabled
      loading={false}
      selectedAgentId=""
      summary={undefined}
      onSelectAgent={vi.fn()}
    />,
  );
}

function renderMcps(): string {
  return renderToStaticMarkup(
    <McpsPage
      agents={[]}
      enabled
      loading={false}
      selectedAgentId=""
      summary={undefined}
      onSelectAgent={vi.fn()}
    />,
  );
}

function renderMemory(): string {
  return renderToStaticMarkup(<MemoryPage agents={[]} enabled />);
}

function renderStatus(): string {
  return renderToStaticMarkup(<StatusPage enabled={false} />);
}

function renderSandboxes(): string {
  return renderToStaticMarkup(
    <SandboxesPage enabled onError={vi.fn()} onSelectSandbox={vi.fn()} />,
  );
}

function renderSessions(): string {
  return renderToStaticMarkup(
    <SessionsPage
      agents={[]}
      sessions={[]}
      sessionsEnabled
      sessionLoadState="idle"
      selectedSessionId=""
      onDeleteSession={vi.fn()}
      onOpenSession={vi.fn()}
      onViewSessionTracing={vi.fn()}
    />,
  );
}

function renderPipelines(): string {
  return renderToStaticMarkup(
    <PipelinesPage
      activeRunId=""
      activeTab="input"
      detail={undefined}
      detailLoading={false}
      enabled
      logs={[]}
      logsLoading={false}
      pipelines={[]}
      runs={[]}
      runsLoading={false}
      runInput=""
      runOutput=""
      runState="idle"
      selectedPipelineId=""
      theme="light"
      onReplayRun={vi.fn()}
      onRun={vi.fn()}
      onRunInputChange={vi.fn()}
      onSelectPipeline={vi.fn()}
      onTabChange={vi.fn()}
    />,
  );
}

function emptyStateCount(html: string): number {
  return html.match(/data-slot="studio-empty-state"/g)?.length ?? 0;
}

function emptyStateClasses(html: string): string[] {
  const match = html.match(/data-slot="studio-empty-state" class="([^"]+)"/);
  if (match?.[1] === undefined) {
    throw new Error("Studio empty state class list not found");
  }
  return match[1].split(" ");
}
