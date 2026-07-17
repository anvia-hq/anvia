import { ExternalLinkIcon, Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { knowledgeTabs } from "../knowledge/knowledge-model";
import { logoSrc } from "../shared/path";
import type { ActivePage, KnowledgeTab } from "../shared/types";
import { NavButton } from "./nav-button";

const knowledgeNavIcons = {
  "static-context": "book-open-text",
  "dynamic-context": "database-lightning",
  "dynamic-tools": "tools",
  "retrieval-log": "search-list",
} as const;

export function StudioSidebar(props: {
  activePage: ActivePage;
  evalsEnabled: boolean;
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
}) {
  return (
    <aside className="flex h-[100dvh] min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-15 items-center px-4">
        <div className="studio-logo-lockup min-w-0">
          <img className="h-auto w-[92px] shrink-0 object-contain" src={logoSrc} alt="Anvia" />
          <span className="studio-logo-badge">Studio</span>
        </div>
      </div>
      <nav className="grid gap-0.5 px-3 py-3" aria-label="Main">
        <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground opacity-50">
          Workspace
        </div>
        <NavButton
          active={props.activePage === "playground"}
          disabled={!props.hasAgents}
          icon="message"
          label="Chat"
          onClick={() => props.onNavigate("playground")}
        />
        <NavButton
          active={props.activePage === "pipelines"}
          disabled={!props.pipelinesEnabled}
          icon="workflow"
          label="Pipelines"
          onClick={() => props.onNavigate("pipelines")}
        />
        <NavButton
          active={props.activePage === "evals"}
          disabled={!props.evalsEnabled}
          icon="gauge"
          label="Evals"
          onClick={() => props.onNavigate("evals")}
        />
        <NavButton
          active={props.activePage === "sessions"}
          disabled={!props.sessionsEnabled}
          icon="list"
          label="Sessions"
          onClick={() => props.onNavigate("sessions")}
        />
        <NavButton
          active={props.activePage === "tracing"}
          disabled={!props.tracesEnabled}
          icon="activity"
          label="Traces"
          onClick={() => props.onNavigate("tracing")}
        />
      </nav>
      <nav className="grid gap-0.5 px-3 py-3" aria-label="Studio">
        <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground opacity-50">
          Inspect
        </div>
        <NavButton
          active={props.activePage === "agents"}
          icon="bot"
          label="Studio"
          onClick={() => props.onNavigate("agents")}
        />
        <NavButton
          active={props.activePage === "tools"}
          disabled={!props.toolsEnabled}
          icon="wrench"
          label="Tools"
          onClick={() => props.onNavigate("tools")}
        />
        <NavButton
          active={props.activePage === "sandboxes"}
          disabled={!props.sandboxesEnabled}
          icon="container"
          label="Sandboxes"
          onClick={() => props.onNavigate("sandboxes")}
        />
        <NavButton
          active={props.activePage === "mcps"}
          disabled={!props.mcpsEnabled}
          icon="plug"
          label="MCPs"
          onClick={() => props.onNavigate("mcps")}
        />
        {knowledgeTabs.map((tab) => (
          <NavButton
            active={props.activePage === "knowledge" && props.knowledgeTab === tab.id}
            disabled={!props.knowledgeEnabled}
            icon={knowledgeNavIcons[tab.id]}
            key={tab.id}
            label={tab.label}
            onClick={() => props.onNavigateKnowledgeTab(tab.id)}
          />
        ))}
        <NavButton
          active={props.activePage === "memory"}
          disabled={!props.memoryEnabled}
          icon="database"
          label="Memory"
          onClick={() => props.onNavigate("memory")}
        />
        <NavButton
          active={props.activePage === "status"}
          disabled={!props.statusEnabled}
          icon="gauge"
          label="Status"
          onClick={() => props.onNavigate("status")}
        />
      </nav>
      <div className="mt-auto px-3 py-3">
        <nav className="grid gap-1" aria-label="Anvia links">
          <SidebarLink href="https://anvia.dev/docs" label="Anvia Docs" />
        </nav>
        <span className="sr-only" aria-live="polite">
          {props.status}
        </span>
      </div>
    </aside>
  );
}

export function StudioHeader(props: {
  activePage: ActivePage;
  selectedAgentLabel: string;
  sessionsEnabled: boolean;
  theme: "light" | "dark";
  onNavigate: (page: ActivePage) => void;
  onNewSession: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="grid min-h-13 border-b border-border bg-background/88 backdrop-blur">
      <div className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-0 pl-4 pr-6">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="text-foreground">
            {props.activePage === "playground" ? "Agents" : "Studio"}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate">{props.selectedAgentLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label={props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="h-8 min-h-8 w-8 border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/45 hover:text-foreground"
            title={props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            type="button"
            variant="ghost"
            size="icon"
            onClick={props.onToggleTheme}
          >
            {props.theme === "dark" ? (
              <StudioIcon icon={Sun02Icon} aria-hidden="true" />
            ) : (
              <StudioIcon icon={Moon02Icon} aria-hidden="true" />
            )}
          </Button>
          <Button
            className="h-8 min-h-8 rounded-lg border border-white bg-white px-3 text-xs text-black shadow-none [box-shadow:none] hover:border-white hover:bg-white/90 hover:text-black focus-visible:ring-0 active:bg-white/85 disabled:bg-muted disabled:text-muted-foreground"
            type="button"
            variant="ghost"
            disabled={!props.sessionsEnabled}
            onClick={props.onNewSession}
          >
            New session
          </Button>
        </div>
      </div>
    </header>
  );
}

function SidebarLink(props: { href: string; label: string }) {
  return (
    <a
      className="flex h-8 min-h-8 items-center justify-between rounded-lg px-2 text-xs font-semibold text-sidebar-foreground/62 transition duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      href={props.href}
      target="_blank"
      rel="noreferrer"
    >
      <span>{props.label}</span>
      <StudioIcon
        icon={ExternalLinkIcon}
        aria-hidden="true"
        className="h-3 w-3 text-muted-foreground"
      />
    </a>
  );
}
