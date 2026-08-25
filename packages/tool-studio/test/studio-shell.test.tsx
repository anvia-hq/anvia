// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  it("keeps the compact rail logo-only and renders both menu groups in the sidebar", () => {
    const rail = renderToStaticMarkup(<StudioRail {...navigation} />);
    const sidebar = renderToStaticMarkup(<StudioSidebar {...navigation} />);

    expect(rail).toContain('aria-label="Open Chat"');
    expect(rail).not.toContain('aria-label="Sections"');
    expect(rail).not.toContain('aria-label="Workspace"');
    expect(rail).not.toContain('aria-label="Inspect"');
    expect(sidebar).toContain('aria-label="Workspace"');
    expect(sidebar).toContain('aria-label="Inspect"');
    expect(sidebar).toContain("Chat");
    expect(sidebar).toContain("Tools");
    expect(sidebar).toContain("Static Context");
    expect(sidebar).toContain("<hr");
    expect(sidebar).toContain('href="https://github.com/anvia-hq/anvia"');
    expect(sidebar).toContain("Enjoying Anvia Studio?");
    expect(sidebar).toContain("Star us on GitHub");
    expect(sidebar).toContain('href="https://docs.anvia.dev"');
    expect(sidebar).toContain("font-[400]");
    expect(sidebar).toContain("transition-none");
    expect(sidebar).not.toContain("font-semibold");
    expect(sidebar).not.toContain(">Inspect</div>");
    expect(sidebar).not.toContain(">Workspace</div>");
  });

  it("keeps every menu accessible when runtime capabilities are unavailable", () => {
    const sidebar = renderToStaticMarkup(
      <StudioSidebar
        {...navigation}
        hasAgents={false}
        knowledgeEnabled={false}
        mcpsEnabled={false}
        memoryEnabled={false}
        pipelinesEnabled={false}
        sandboxesEnabled={false}
        sessionsEnabled={false}
        statusEnabled={false}
        toolsEnabled={false}
        tracesEnabled={false}
      />,
    );

    expect(sidebar).not.toMatch(/\sdisabled(?:=""|(?=[\s>]))/);
    expect(sidebar).toContain("Chat");
    expect(sidebar).toContain("Pipelines");
    expect(sidebar).toContain("Sessions");
    expect(sidebar).toContain("Traces");
    expect(sidebar).toContain("Studio");
    expect(sidebar).toContain("Tools");
    expect(sidebar).toContain("Sandboxes");
    expect(sidebar).toContain("MCPs");
    expect(sidebar).toContain("Static Context");
    expect(sidebar).toContain("Memory");
    expect(sidebar).toContain("Status");
  });

  it("renders Studio breadcrumbs and the dark-first theme control", () => {
    const html = renderToStaticMarkup(
      <StudioHeader
        activePage="playground"
        knowledgeTab="static-context"
        navigation={navigation}
        selectedAgentLabel="Support"
        sessionsEnabled
        theme="dark"
        onNewSession={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain("Workspace");
    expect(html).toContain("Chat");
    expect(html).toContain("Support");
    expect(html).toContain('aria-label="Theme: dark. Switch to light theme"');
    expect(html).toContain("New session");
  });

  it("opens every navigation destination from the mobile header menu", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <StudioHeader
          activePage="playground"
          knowledgeTab="static-context"
          navigation={{ ...navigation, onNavigate }}
          selectedAgentLabel="Support"
          sessionsEnabled
          theme="dark"
          onNewSession={vi.fn()}
          onToggleTheme={vi.fn()}
        />,
      ),
    );

    const menuButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open navigation"]',
    );
    act(() => menuButton?.click());

    expect(document.body.textContent).toContain("Sessions");
    expect(document.body.textContent).toContain("Traces");
    expect(document.body.textContent).toContain("Static Context");
    const toolsButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Tools",
    );
    act(() => toolsButton?.click());
    expect(onNavigate).toHaveBeenCalledWith("tools");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
