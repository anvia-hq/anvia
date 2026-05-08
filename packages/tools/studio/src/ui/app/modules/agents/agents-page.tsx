import type { StudioConfig } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";

export function AgentsPage(props: { agents: StudioConfig["agents"]; selectedAgentId: string }) {
  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Agents"
    >
      <header className="border-b border-border/80 bg-background/70 px-6 py-5 backdrop-blur">
        <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              Studio registry
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Studio
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Registered agents, operational prompts, and runtime metadata for Studio agents.
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1500px] gap-4">
          {props.agents.length === 0 ? (
            <div className="grid min-h-80 place-items-center border border-dashed border-border/80 bg-card/35 px-6 text-center">
              <div className="grid max-w-md gap-2">
                <h2 className="m-0 text-base font-semibold text-foreground">No agents</h2>
                <p className="m-0 text-sm leading-6 text-muted-foreground">
                  Studio has no registered agents to inspect.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {props.agents.map((agent) => (
                <AgentDossier
                  agent={agent}
                  active={agent.id === props.selectedAgentId}
                  key={agent.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentDossier(props: { agent: StudioConfig["agents"][number]; active: boolean }) {
  const metadata = metadataEntries(props.agent.metadata);

  return (
    <article
      className={cn(
        "grid overflow-hidden border border-border/80 bg-card/45 shadow-sm transition duration-200 hover:border-border hover:bg-card/60",
        props.active && "border-primary/35 bg-card/70 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.08)]",
      )}
    >
      <div className="grid gap-0 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1fr)_minmax(280px,0.7fr)]">
        <section className="grid content-between gap-8 border-b border-border/70 p-5 xl:border-b-0 xl:border-r">
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Badge
                className={cn(
                  "border-border/80 bg-muted/45 text-muted-foreground",
                  props.active && "border-primary/35 bg-primary/10 text-primary",
                )}
              >
                {props.active ? "selected" : "agent"}
              </Badge>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {props.agent.quickPrompts.length} prompts
              </span>
            </div>
            <div className="grid gap-2">
              <h2 className="m-0 text-xl font-semibold leading-tight tracking-tight text-foreground text-balance">
                {props.agent.name ?? props.agent.id}
              </h2>
              <span className="min-w-0 break-all font-mono text-xs font-medium leading-5 text-muted-foreground">
                {props.agent.id}
              </span>
            </div>
          </div>
          <div className="h-px w-20 bg-primary/55" />
        </section>

        <section className="grid content-start gap-5 border-b border-border/70 p-5 xl:border-b-0 xl:border-r">
          <div className="grid gap-2">
            <SectionLabel>description</SectionLabel>
            <p className="m-0 max-w-[72ch] text-sm leading-6 text-muted-foreground">
              {props.agent.description ?? "No description"}
            </p>
          </div>
          <div className="grid gap-2">
            <SectionLabel>quick prompts</SectionLabel>
            {props.agent.quickPrompts.length === 0 ? (
              <div className="border border-dashed border-border/80 bg-background/35 px-3 py-2 text-sm text-muted-foreground">
                None configured
              </div>
            ) : (
              <div className="grid gap-2">
                {props.agent.quickPrompts.map((prompt, index) => (
                  <div
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border border-border/70 bg-background/35 px-3 py-2 text-sm leading-6 text-foreground"
                    key={prompt}
                  >
                    <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{prompt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid content-start gap-3 p-5">
          <SectionLabel>metadata</SectionLabel>
          {metadata.length === 0 ? (
            <div className="border border-dashed border-border/80 bg-background/35 px-3 py-2 text-sm text-muted-foreground">
              None
            </div>
          ) : (
            <div className="grid divide-y divide-border/70 border border-border/70 bg-background/35">
              {metadata.map(([key, value]) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(110px,0.75fr)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm"
                  key={key}
                >
                  <span className="min-w-0 truncate font-medium text-muted-foreground" title={key}>
                    {key}
                  </span>
                  <span
                    className="min-w-0 truncate font-mono text-xs text-foreground"
                    title={formatMetadataValue(value)}
                  >
                    {formatMetadataValue(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <h3 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      {props.children}
    </h3>
  );
}

function metadataEntries(metadata: StudioConfig["agents"][number]["metadata"]) {
  if (metadata === undefined) {
    return [];
  }
  return Object.entries(metadata);
}

function formatMetadataValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (typeof value === "object") {
    return "{...}";
  }
  return "";
}
