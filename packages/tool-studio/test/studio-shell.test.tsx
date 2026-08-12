import { MagnifyingGlass, Play } from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { navIcon } from "../src/ui/app/modules/shell/nav-button";
import {
  StudioHeader,
  type StudioNavigationProps,
  StudioRail,
  StudioSidebar,
} from "../src/ui/app/modules/shell/studio-shell";

const navigation: StudioNavigationProps = {
  activePage: "tools",
  hasAgents: true,
  knowledgeEnabled: true,
  mcpsEnabled: true,
  memoryEnabled: true,
  pipelinesEnabled: true,
  sandboxesEnabled: true,
  sessionsEnabled: true,
  status: "Connected",
  statusEnabled: true,
  toolsEnabled: true,
  tracesEnabled: true,
  knowledgeTab: "static-context",
  onNavigate: vi.fn(),
  onNavigateKnowledgeTab: vi.fn(),
};

describe("Studio Lens shell", () => {
  it("uses play and inspection icons for the compact section rail", () => {
    expect(navIcon("play")).toBe(Play);
    expect(navIcon("inspect")).toBe(MagnifyingGlass);
  });

  it("renders active section controls and section-specific sidebar routes", () => {
    const rail = renderToStaticMarkup(<StudioRail {...navigation} />);
    const sidebar = renderToStaticMarkup(<StudioSidebar {...navigation} />);

    expect(rail).toContain('aria-label="Inspect"');
    expect(rail).toMatch(/aria-current="page"[^>]+aria-label="Inspect"/);
    expect(sidebar).toContain('aria-label="Inspect"');
    expect(sidebar).toContain("Tools");
    expect(sidebar).toContain("Static Context");
    expect(sidebar).toContain('href="https://docs.anvia.dev"');
    expect(sidebar).not.toContain(">Inspect</div>");
    expect(sidebar).not.toContain(">Chat<");
  });

  it("renders Lens breadcrumbs and the tri-state theme control", () => {
    const html = renderToStaticMarkup(
      <StudioHeader
        activePage="playground"
        knowledgeTab="static-context"
        selectedAgentLabel="Support"
        sessionsEnabled
        theme="system"
        onNewSession={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain("Workspace");
    expect(html).toContain("Chat");
    expect(html).toContain("Support");
    expect(html).toContain('aria-label="Theme: system. Switch to light theme"');
    expect(html).toContain("New session");
  });
});
