// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionsPage } from "../src/ui/app/modules/sessions/sessions-page";

describe("SessionsPage table state", () => {
  it("does not render session rows or surface above an empty state", () => {
    const html = renderSessions();

    expect(emptyStateCount(html)).toBe(1);
    expect(html).not.toContain("<button");
  });

  it("renders session rows when sessions exist", () => {
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
    expect(html).toContain("<button");
    expect(html).toContain("Support chat");
  });
});

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

function emptyStateCount(html: string): number {
  return html.match(/data-slot="studio-empty-state"/g)?.length ?? 0;
}
