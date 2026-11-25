// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { StudioHeader, type StudioNavigationProps } from "../src/ui/app/modules/shell/studio-shell";

const navigation: StudioNavigationProps = {
  activePage: "tools",
  hasAgents: true,
  graphsEnabled: true,
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

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const toolsButton = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Tools",
    );
    act(() => toolsButton?.click());
    expect(onNavigate).toHaveBeenCalledWith("tools");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
