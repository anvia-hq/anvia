import { useEffect, useState } from "react";
import type { StudioAgentRuntimeSummary, StudioConfig } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";

export function AgentsPage(props: { agents: StudioConfig["agents"]; selectedAgentId: string }) {
  const [runtimeByAgentId, setRuntimeByAgentId] = useState<
    Record<string, StudioAgentRuntimeSummary | undefined>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function loadRuntimeSummaries() {
      const entries = await Promise.all(
        props.agents.map(async (agent) => {
          try {
            const response = await fetch(`/agents/${encodeURIComponent(agent.id)}/runtime`);
            if (!response.ok) {
              return [agent.id, undefined] as const;
            }
            return [agent.id, (await response.json()) as StudioAgentRuntimeSummary] as const;
          } catch {
            return [agent.id, undefined] as const;
          }
        }),
      );
      if (!cancelled) {
        setRuntimeByAgentId(Object.fromEntries(entries));
      }
    }
    void loadRuntimeSummaries();
    return () => {
      cancelled = true;
    };
  }, [props.agents]);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Agents"
    >
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className=" text-xs font-semibold uppercase tracking-[0.24em] text-foreground">
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

      <div className="min-h-0 overflow-auto pb-6 pl-0 pr-6">
        <div className="grid w-full gap-4">
          {props.agents.length === 0 ? (
            <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border/80 bg-card/35 px-6 text-center">
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
                  runtime={runtimeByAgentId[agent.id]}
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

function AgentDossier(props: {
  agent: StudioConfig["agents"][number];
  runtime: StudioAgentRuntimeSummary | undefined;
  active: boolean;
}) {
  const metadata = metadataEntries(props.agent.metadata);
  const runtime = props.runtime;

  return (
    <article
      className={cn(
        "grid overflow-hidden rounded-xl border border-border/80 bg-card/45 p-2 shadow-sm transition duration-200 hover:border-border hover:bg-card/60",
        props.active && "border-border/80 bg-card/70 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.08)]",
      )}
    >
      <div className="grid gap-2 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1fr)_minmax(280px,0.7fr)]">
        <section className="grid content-between gap-8 rounded-lg bg-background/35 p-5">
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Badge
                className={cn(
                  "border-border/80 bg-muted/45 text-muted-foreground",
                  props.active && "border-border/80 bg-muted/45 text-foreground",
                )}
              >
                {props.active ? "selected" : "agent"}
              </Badge>
              <span className=" text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {props.agent.quickPrompts.length} prompts
              </span>
            </div>
            <div className="grid gap-2">
              <h2 className="m-0 text-xl font-semibold leading-tight tracking-tight text-foreground text-balance">
                {props.agent.name ?? props.agent.id}
              </h2>
              <span className="min-w-0 break-all text-xs font-medium leading-5 text-muted-foreground">
                {props.agent.id}
              </span>
            </div>
          </div>
          <div className="h-px w-20 bg-muted/55" />
        </section>

        <section className="grid content-start gap-5 rounded-lg bg-background/35 p-5">
          <div className="grid gap-2">
            <SectionLabel>description</SectionLabel>
            <p className="m-0 max-w-[72ch] text-sm leading-6 text-muted-foreground">
              {props.agent.description ?? "No description"}
            </p>
          </div>
          <div className="grid gap-2">
            <SectionLabel>quick prompts</SectionLabel>
            {props.agent.quickPrompts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 bg-background/45 px-3 py-2 text-sm text-muted-foreground">
                None configured
              </div>
            ) : (
              <div className="grid gap-2">
                {props.agent.quickPrompts.map((prompt, index) => (
                  <div
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg border border-border/70 bg-background/45 px-3 py-2 text-sm leading-6 text-foreground"
                    key={prompt}
                  >
                    <span className=" text-xs font-semibold text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{prompt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid content-start gap-3 rounded-lg bg-background/35 p-5">
          <SectionLabel>runtime</SectionLabel>
          {runtime === undefined ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/45 px-3 py-2 text-sm text-muted-foreground">
              Runtime summary unavailable
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <RuntimeMetric label="tools" value={runtime.toolCount} />
                <RuntimeMetric label="mcp" value={runtime.mcpToolCount} />
                <RuntimeMetric
                  label="context"
                  value={runtime.staticContextCount + runtime.dynamicContextCount}
                />
                <RuntimeMetric label="observers" value={runtime.observerCount} />
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Badge className={runtime.hasMemory ? enabledBadge : disabledBadge}>memory</Badge>
                <Badge className={runtime.hasHook ? enabledBadge : disabledBadge}>hook</Badge>
                <Badge className={runtime.hasOutputSchema ? enabledBadge : disabledBadge}>
                  output schema
                </Badge>
                {runtime.defaultMaxTurns === undefined ? null : (
                  <Badge className="border-border/80 bg-muted/55 text-muted-foreground">
                    {runtime.defaultMaxTurns} turns
                  </Badge>
                )}
              </div>
              {runtime.model === undefined ? null : (
                <div className="grid min-w-0 gap-1 rounded-lg bg-muted/20 px-3 py-2 text-sm">
                  <span className=" text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    model
                  </span>
                  <span
                    className="min-w-0 truncate text-xs text-foreground"
                    title={formatMetadataValue(runtime.model)}
                  >
                    {formatMetadataValue(runtime.model)}
                  </span>
                </div>
              )}
            </div>
          )}

          <SectionLabel>metadata</SectionLabel>
          {metadata.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/45 px-3 py-2 text-sm text-muted-foreground">
              None
            </div>
          ) : (
            <div className="grid gap-1">
              {metadata.map(([key, value]) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(110px,0.75fr)_minmax(0,1fr)] gap-3 rounded-lg bg-muted/20 px-3 py-2 text-sm"
                  key={key}
                >
                  <span className="min-w-0 truncate font-medium text-muted-foreground" title={key}>
                    {key}
                  </span>
                  <span
                    className="min-w-0 truncate text-xs text-foreground"
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

const enabledBadge = "border-border/80 bg-muted/45 text-foreground";
const disabledBadge = "border-border/80 bg-muted/55 text-muted-foreground";

function RuntimeMetric(props: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-lg bg-muted/20 px-3 py-2">
      <span className=" text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </span>
      <span className=" text-lg font-semibold text-foreground">{props.value}</span>
    </div>
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
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
