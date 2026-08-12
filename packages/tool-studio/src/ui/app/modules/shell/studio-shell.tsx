import { ArrowSquareOut, Laptop, Moon, Sun } from "@phosphor-icons/react";
import type { StudioTheme } from "../../app-theme";
import { AnviaLensLogo } from "../../components/anvia-lens-logo";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { knowledgeTabs } from "../knowledge/knowledge-model";
import { pageTitle } from "../shared/format";
import { navigationSection } from "../shared/navigation";
import type { ActivePage, KnowledgeTab } from "../shared/types";
import { type IconName, NavButton } from "./nav-button";

const knowledgeNavIcons = {
  "static-context": "book-open-text",
  "dynamic-context": "database-lightning",
  "dynamic-tools": "tools",
  "retrieval-log": "search-list",
} as const;

export type StudioNavigationProps = {
  activePage: ActivePage;
  hasAgents: boolean;
  knowledgeEnabled: boolean;
  mcpsEnabled: boolean;
  memoryEnabled: boolean;
  pipelinesEnabled: boolean;
  sandboxesEnabled: boolean;
  sessionsEnabled: boolean;
  status: string;
  statusEnabled: boolean;
  toolsEnabled: boolean;
  tracesEnabled: boolean;
  knowledgeTab: KnowledgeTab;
  onNavigate: (page: ActivePage) => void;
  onNavigateKnowledgeTab: (tab: KnowledgeTab) => void;
};

type NavigationItem = {
  label: string;
  icon: IconName;
  page: ActivePage;
  enabled: boolean;
  knowledgeTab?: KnowledgeTab;
};

function navigationItems(props: StudioNavigationProps): NavigationItem[] {
  return [
    {
      page: "playground",
      label: "Chat",
      icon: "message",
      enabled: props.hasAgents,
    },
    {
      page: "pipelines",
      label: "Pipelines",
      icon: "workflow",
      enabled: props.pipelinesEnabled,
    },
    { page: "sessions", label: "Sessions", icon: "list", enabled: props.sessionsEnabled },
    { page: "tracing", label: "Traces", icon: "activity", enabled: props.tracesEnabled },
    { page: "agents", label: "Studio", icon: "bot", enabled: true },
    { page: "tools", label: "Tools", icon: "wrench", enabled: props.toolsEnabled },
    {
      page: "sandboxes",
      label: "Sandboxes",
      icon: "container",
      enabled: props.sandboxesEnabled,
    },
    { page: "mcps", label: "MCPs", icon: "plug", enabled: props.mcpsEnabled },
    ...knowledgeTabs.map((tab) => ({
      page: "knowledge" as const,
      label: tab.label,
      icon: knowledgeNavIcons[tab.id],
      enabled: props.knowledgeEnabled,
      knowledgeTab: tab.id,
    })),
    { page: "memory", label: "Memory", icon: "database", enabled: props.memoryEnabled },
    { page: "status", label: "Status", icon: "gauge", enabled: props.statusEnabled },
  ];
}

function itemIsActive(item: NavigationItem, props: StudioNavigationProps): boolean {
  return (
    item.page === props.activePage &&
    (item.knowledgeTab === undefined || item.knowledgeTab === props.knowledgeTab)
  );
}

function navigateToItem(item: NavigationItem, props: StudioNavigationProps): void {
  if (item.knowledgeTab === undefined) {
    props.onNavigate(item.page);
  } else {
    props.onNavigateKnowledgeTab(item.knowledgeTab);
  }
}

export function StudioRail(props: StudioNavigationProps) {
  return (
    <aside
      aria-label="Anvia Studio"
      className="flex h-[100dvh] w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex shrink-0 justify-center p-2">
        <button
          className="flex size-10 items-center justify-center rounded-lg outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
          type="button"
          aria-label="Open Chat"
          title="Anvia Studio"
          onClick={() => props.onNavigate("playground")}
        >
          <span className="grid size-8 place-items-center rounded-md border border-[#2BF563] bg-[#2BF563]">
            <AnviaLensLogo markClassName="text-black" />
          </span>
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {props.status}
      </span>
    </aside>
  );
}

export function StudioSidebar(props: StudioNavigationProps) {
  const items = navigationItems(props);
  const workspaceItems = items.filter((item) => navigationSection(item.page) === "workspace");
  const inspectItems = items.filter((item) => navigationSection(item.page) === "inspect");

  return (
    <aside className="hidden h-[100dvh] w-64 min-h-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <nav className="grid gap-1 px-2" aria-label="Workspace">
          {workspaceItems.map((item) => (
            <NavButton
              active={itemIsActive(item, props)}
              disabled={!item.enabled}
              icon={item.icon}
              key={`${item.page}-${item.knowledgeTab ?? "page"}`}
              label={item.label}
              onClick={() => navigateToItem(item, props)}
            />
          ))}
        </nav>
        <hr className="mx-2 my-2 border-sidebar-border" />
        <nav className="grid gap-1 px-2" aria-label="Inspect">
          {inspectItems.map((item) => (
            <NavButton
              active={itemIsActive(item, props)}
              disabled={!item.enabled}
              icon={item.icon}
              key={`${item.page}-${item.knowledgeTab ?? "page"}`}
              label={item.label}
              onClick={() => navigateToItem(item, props)}
            />
          ))}
        </nav>
      </div>
      <div className="shrink-0 p-2">
        <SidebarLink href="https://docs.anvia.dev" label="Anvia Docs" />
      </div>
    </aside>
  );
}

export function StudioHeader(props: {
  activePage: ActivePage;
  knowledgeTab: KnowledgeTab;
  selectedAgentLabel: string;
  sessionsEnabled: boolean;
  theme: StudioTheme;
  onNewSession: () => void;
  onToggleTheme: () => void;
}) {
  const section = navigationSection(props.activePage);
  const pageLabel =
    props.activePage === "playground"
      ? "Chat"
      : props.activePage === "knowledge"
        ? (knowledgeTabs.find((tab) => tab.id === props.knowledgeTab)?.label ?? "Knowledge")
        : pageTitle(props.activePage, undefined);
  const nextTheme =
    props.theme === "system" ? "light" : props.theme === "light" ? "dark" : "system";
  const themeLabel = `Theme: ${props.theme}. Switch to ${nextTheme} theme`;
  const themeIcon = props.theme === "system" ? Laptop : props.theme === "light" ? Sun : Moon;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <nav className="flex min-w-0 flex-1 items-center gap-2 text-base" aria-label="Breadcrumb">
        <span className="font-medium">{section === "workspace" ? "Workspace" : "Inspect"}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          /
        </span>
        <span className="truncate text-muted-foreground">{pageLabel}</span>
        {props.activePage === "playground" ? (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
            <span className="truncate text-muted-foreground">{props.selectedAgentLabel}</span>
          </>
        ) : null}
      </nav>
      <Button
        aria-label={themeLabel}
        title={themeLabel}
        type="button"
        variant="ghost"
        size="icon"
        onClick={props.onToggleTheme}
      >
        <StudioIcon icon={themeIcon} aria-hidden="true" />
      </Button>
      <Button type="button" disabled={!props.sessionsEnabled} onClick={props.onNewSession}>
        New session
      </Button>
    </header>
  );
}

function SidebarLink(props: { href: string; label: string }) {
  return (
    <a
      className="flex h-8 items-center justify-between rounded-lg px-2 text-base font-[450] tracking-[-0.006em] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      href={props.href}
      target="_blank"
      rel="noreferrer"
    >
      <span>{props.label}</span>
      <StudioIcon icon={ArrowSquareOut} aria-hidden="true" className="size-3.5" />
    </a>
  );
}
