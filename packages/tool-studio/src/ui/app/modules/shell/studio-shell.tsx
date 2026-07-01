import { ArchiveIcon, ExternalLinkIcon, Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import type { StudioSessionSummary } from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../shared/format";
import { logoSrc } from "../shared/path";
import type { ActivePage, RunState } from "../shared/types";
import { NavButton } from "./nav-button";

export function StudioSidebar(props: {
  activePage: ActivePage;
  allSessions: StudioSessionSummary[];
  evalsEnabled: boolean;
  hasAgents: boolean;
  knowledgeEnabled: boolean;
  mcpsEnabled: boolean;
  memoryEnabled: boolean;
  pipelinesEnabled: boolean;
  runState: RunState;
  selectedSessionId: string;
  sessionsEnabled: boolean;
  status: string;
  statusEnabled: boolean;
  toolsEnabled: boolean;
  tracesEnabled: boolean;
  onDeleteSession: (session: StudioSessionSummary) => void;
  onLoadSession: (sessionId: string) => void;
  onNavigate: (page: ActivePage) => void;
}) {
  return (
    <aside className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="flex h-15 items-center px-4">
        <div className="studio-logo-lockup min-w-0">
          <img className="h-auto w-[92px] shrink-0 object-contain" src={logoSrc} alt="Anvia" />
          <span className="studio-logo-badge">Studio</span>
        </div>
      </div>
      <nav className="grid gap-0.5 px-3 py-3" aria-label="Main">
        <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Workspace
        </div>
        <NavButton
          active={props.activePage === "playground"}
          icon="message"
          label="Chat"
          onClick={() => props.onNavigate("playground")}
        />
        <NavButton
          active={props.activePage === "pipelines"}
          icon="workflow"
          label="Pipelines"
          onClick={() => props.onNavigate("pipelines")}
        />
        <NavButton
          active={props.activePage === "evals"}
          icon="gauge"
          label="Evals"
          onClick={() => props.onNavigate("evals")}
        />
        <NavButton
          active={props.activePage === "sessions"}
          icon="list"
          label="Sessions"
          onClick={() => props.onNavigate("sessions")}
        />
        <NavButton
          active={props.activePage === "tracing"}
          icon="activity"
          label="Traces"
          onClick={() => props.onNavigate("tracing")}
        />
      </nav>
      <nav className="grid gap-0.5 px-3 py-3" aria-label="Studio">
        <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
          icon="wrench"
          label="Tools"
          onClick={() => props.onNavigate("tools")}
        />
        <NavButton
          active={props.activePage === "mcps"}
          icon="plug"
          label="MCPs"
          onClick={() => props.onNavigate("mcps")}
        />
        <NavButton
          active={props.activePage === "knowledge"}
          icon="database"
          label="Knowledge"
          onClick={() => props.onNavigate("knowledge")}
        />
        <NavButton
          active={props.activePage === "memory"}
          icon="database"
          label="Memory"
          onClick={() => props.onNavigate("memory")}
        />
        <NavButton
          active={props.activePage === "status"}
          icon="gauge"
          label="Status"
          onClick={() => props.onNavigate("status")}
        />
      </nav>
      <nav className="grid min-h-0 gap-0.5 overflow-auto px-3 py-3" aria-label="Recent sessions">
        <div className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Recent
        </div>
        {props.allSessions.slice(0, 8).map((session) => (
          <div
            className={cn(
              "group grid min-h-7 min-w-0 grid-cols-[minmax(0,1fr)_36px] items-center gap-1 rounded-lg pr-1 transition duration-200 hover:bg-sidebar-accent/80 focus-within:bg-sidebar-accent/80",
              session.id === props.selectedSessionId && "bg-sidebar-accent",
            )}
            key={session.id}
          >
            <Button
              className={cn(
                "grid h-auto min-h-7 min-w-0 justify-start rounded-lg border-0 bg-transparent px-2.5 py-0.5 text-left text-sidebar-foreground/72 shadow-none hover:bg-transparent hover:text-sidebar-foreground",
                session.id === props.selectedSessionId && "text-sidebar-accent-foreground",
              )}
              type="button"
              variant="ghost"
              onClick={() => props.onLoadSession(session.id)}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {session.title ?? "Untitled chat"}
              </span>
            </Button>
            <div className="relative grid h-7 min-w-0 place-items-end">
              <time className="grid h-6 min-w-6 place-items-center self-center justify-self-end rounded-lg px-1.5 text-sm font-medium tabular-nums text-muted-foreground group-hover:opacity-0 group-focus-within:opacity-0">
                {formatRelativeTime(session.updatedAt)}
              </time>
              <Button
                aria-label={`Delete ${session.title ?? "Untitled chat"}`}
                className="absolute right-0 top-1/2 hidden h-6 min-h-6 w-6 -translate-y-1/2 border-0 bg-transparent p-0 text-muted-foreground opacity-70 shadow-none hover:bg-transparent hover:text-destructive hover:opacity-100 group-hover:grid group-focus-within:grid [&_svg]:h-3.5 [&_svg]:w-3.5"
                size="icon"
                type="button"
                variant="ghost"
                disabled={props.runState === "running"}
                onClick={() => props.onDeleteSession(session)}
              >
                <StudioIcon icon={ArchiveIcon} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
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
    <header className="grid min-h-13 bg-background/88 backdrop-blur">
      <div className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-0 pl-0 pr-6">
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
