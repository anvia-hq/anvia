import { type ReactNode, useEffect, useState } from "react";
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

  const totals = registryTotals(props.agents, runtimeByAgentId);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Agents"
    >
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Studio
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Registered agents and the runtime capabilities exposed to Studio.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
            <HeaderMetric label="agents" value={props.agents.length} />
            <HeaderMetric label="tools" value={totals.tools} />
            <HeaderMetric label="context" value={totals.context} />
            <HeaderMetric label="prompts" value={totals.prompts} />
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-4 pr-6">
        <div className="grid w-full">
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
            <AgentRegistryTable
              agents={props.agents}
              runtimeByAgentId={runtimeByAgentId}
              selectedAgentId={props.selectedAgentId}
            />
          )}
        </div>
      </div>
    </section>
  );
}

type RuntimeByAgentId = Record<string, StudioAgentRuntimeSummary | undefined>;

function AgentRegistryTable(props: {
  agents: StudioConfig["agents"];
  runtimeByAgentId: RuntimeByAgentId;
  selectedAgentId: string;
}) {
  return (
    <div className="min-w-[980px]">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr>
            <TableHead>Agent</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Runtime</TableHead>
            <TableHead>Capabilities</TableHead>
          </tr>
        </thead>
        <tbody>
          {props.agents.map((agent) => (
            <AgentRegistryRow
              agent={agent}
              active={agent.id === props.selectedAgentId}
              key={agent.id}
              runtime={props.runtimeByAgentId[agent.id]}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentRegistryRow(props: {
  agent: StudioConfig["agents"][number];
  runtime: StudioAgentRuntimeSummary | undefined;
  active: boolean;
}) {
  const runtime = props.runtime;
  const modelLabel =
    runtime === undefined
      ? "Runtime unavailable"
      : runtime.model === undefined
        ? "No model reported"
        : formatModelValue(runtime.model);

  return (
    <tr>
      <TableCell>
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {props.agent.name ?? props.agent.id}
            </span>
            {props.active ? <Badge className={selectedBadge}>selected</Badge> : null}
          </div>
          <span className="min-w-0 break-all text-xs font-medium leading-5 text-muted-foreground">
            {props.agent.id}
          </span>
          <p className="m-0 max-w-[64ch] truncate text-sm leading-6 text-muted-foreground">
            {props.agent.description ?? "No description"}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "block max-w-[260px] truncate text-sm leading-6",
            runtime === undefined ? "text-muted-foreground" : "text-foreground",
          )}
          title={modelLabel}
        >
          {modelLabel}
        </span>
      </TableCell>
      <TableCell>
        {runtime === undefined ? (
          <span className="text-sm leading-6 text-muted-foreground">Waiting for summary</span>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-2">
            <MetricPill label="tools" value={runtime.toolCount} />
            <MetricPill label="mcp" value={runtime.mcpToolCount} />
            <MetricPill
              label="context"
              value={runtime.staticContextCount + runtime.dynamicContextCount}
            />
            <MetricPill label="observers" value={runtime.observerCount} />
            <MetricPill label="prompts" value={props.agent.quickPrompts.length} />
          </div>
        )}
      </TableCell>
      <TableCell>
        {runtime === undefined ? (
          <span className="text-sm leading-6 text-muted-foreground">Not loaded</span>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-2">
            <CapabilityBadge enabled={runtime.hasMemory}>memory</CapabilityBadge>
            <CapabilityBadge enabled={runtime.hasHook}>hook</CapabilityBadge>
            <CapabilityBadge enabled={runtime.hasOutputSchema}>schema</CapabilityBadge>
            {runtime.defaultMaxTurns === undefined ? null : (
              <Badge className={neutralBadge}>{runtime.defaultMaxTurns} turns</Badge>
            )}
          </div>
        )}
      </TableCell>
    </tr>
  );
}

function TableHead(props: { children: string }) {
  return (
    <th className="border-b border-border/80 py-2.5 pr-5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground first:pl-0">
      {props.children}
    </th>
  );
}

function TableCell(props: { children: ReactNode }) {
  return (
    <td className="border-b border-border/70 py-3.5 pr-5 align-top first:pl-0">{props.children}</td>
  );
}

function MetricPill(props: { label: string; value: number }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-muted/25 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

function CapabilityBadge(props: { enabled: boolean; children: string }) {
  return <Badge className={props.enabled ? enabledBadge : disabledBadge}>{props.children}</Badge>;
}

function HeaderMetric(props: { label: string; value: number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/45 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

const selectedBadge = "border-border/80 bg-muted/45 text-foreground";
const enabledBadge = "border-border/80 bg-muted/35 text-foreground";
const disabledBadge = "border-transparent bg-transparent text-muted-foreground/60";
const neutralBadge = "border-border/80 bg-muted/35 text-muted-foreground";

function registryTotals(agents: StudioConfig["agents"], runtimeByAgentId: RuntimeByAgentId) {
  return agents.reduce(
    (totals, agent) => {
      const runtime = runtimeByAgentId[agent.id];
      totals.prompts += agent.quickPrompts.length;
      if (runtime !== undefined) {
        totals.tools += runtime.toolCount + runtime.mcpToolCount;
        totals.context += runtime.staticContextCount + runtime.dynamicContextCount;
      }
      return totals;
    },
    { context: 0, prompts: 0, tools: 0 },
  );
}

function formatModelValue(value: unknown): string {
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
    const model = objectString(value, "model") ?? objectString(value, "defaultModel");
    const provider = objectString(value, "provider");
    const id = objectString(value, "id") ?? objectString(value, "name");
    const modelName = model ?? id;

    if (provider !== undefined && modelName !== undefined && provider !== modelName) {
      return `${provider} / ${modelName}`;
    }
    return modelName ?? provider ?? "Custom model";
  }
  return "";
}

function objectString(value: object, key: string): string | undefined {
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : undefined;
}
