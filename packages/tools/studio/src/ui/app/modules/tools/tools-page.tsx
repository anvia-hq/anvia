import type {
  StudioAgentToolMetadata,
  StudioAgentToolsSummary,
  StudioConfig,
} from "../../../../types";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { cn } from "../../lib/utils";
import { JsonSyntax } from "../shared/renderers";

export function ToolsPage(props: {
  agents: StudioConfig["agents"];
  selectedAgentId: string;
  summary: StudioAgentToolsSummary | undefined;
  enabled: boolean;
  loading: boolean;
  onSelectAgent: (agentId: string) => void;
}) {
  const selectedAgent =
    props.agents.find((agent) => agent.id === props.selectedAgentId) ?? props.agents[0];
  const tools = props.summary?.tools ?? [];

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Tools"
    >
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              Agent capabilities
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Tools
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Tool definitions registered on Studio agents, including approval policy and input
              schema.
            </p>
          </div>
          {props.agents.length > 1 ? (
            <Select value={selectedAgent?.id ?? ""} onValueChange={props.onSelectAgent}>
              <SelectTrigger className="h-9 min-h-9 w-64 rounded-lg border-border bg-card/80 font-mono text-xs max-md:w-full">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent align="end">
                {props.agents.map((agent) => (
                  <SelectItem value={agent.id} key={agent.id}>
                    {agent.name ?? agent.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-0 pr-6">
        <div className="grid w-full gap-4">
          {!props.enabled ? (
            <EmptyState
              title="Tools unavailable"
              message="No registered Studio agent exposes static or dynamic tools."
            />
          ) : props.loading ? (
            <EmptyState title="Loading tools" message="Reading registered tool metadata." />
          ) : tools.length === 0 ? (
            <EmptyState title="No tools" message="The selected agent has no registered tools." />
          ) : (
            <div className="grid gap-1 overflow-hidden rounded-xl border border-border/80 bg-card/55 p-2 shadow-sm">
              <div className="grid min-h-10 grid-cols-[minmax(260px,0.75fr)_minmax(0,1fr)] items-center rounded-lg border border-border/60 bg-muted/20 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground max-lg:hidden">
                <span>Definition</span>
                <span>Parameter schema</span>
              </div>
              {tools.map((tool) => (
                <ToolDefinitionRow tool={tool} key={`${tool.source}:${tool.name}`} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ToolDefinitionRow(props: { tool: StudioAgentToolMetadata }) {
  const propertyCount = schemaPropertyCount(props.tool.parameters);
  return (
    <article className="grid grid-cols-[minmax(300px,0.75fr)_minmax(0,1fr)] gap-2 rounded-lg border border-transparent bg-background/25 p-2 transition duration-200 hover:border-border/70 hover:bg-background/35 max-lg:grid-cols-1">
      <div className="grid content-start gap-4 rounded-lg bg-card/25 p-3">
        <div className="grid gap-1">
          <h2 className="m-0 truncate font-mono text-[15px] font-semibold text-foreground">
            {props.tool.name}
          </h2>
          <span className="truncate font-mono text-[11px] font-medium text-muted-foreground">
            {props.tool.agentId}
          </span>
        </div>
        <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
          {props.tool.description}
        </p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Badge className={sourceBadgeClass(props.tool.source)}>{props.tool.source}</Badge>
          <Badge
            className={cn(
              props.tool.approval.required
                ? "border-primary/35 bg-primary/10 text-primary"
                : "border-border/80 bg-muted/55 text-muted-foreground",
            )}
          >
            approval {props.tool.approval.required ? "required" : "none"}
          </Badge>
          <Badge className="border-border/80 bg-transparent text-muted-foreground">
            {propertyCount} {propertyCount === 1 ? "field" : "fields"}
          </Badge>
        </div>
        {props.tool.approval.reason === undefined ? null : (
          <p className="m-0 rounded-lg bg-primary/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {props.tool.approval.reason}
          </p>
        )}
      </div>
      <SchemaBlock value={props.tool.parameters} />
    </article>
  );
}

function SchemaBlock(props: { value: unknown }) {
  return (
    <section className="grid min-w-0 content-start overflow-hidden rounded-lg bg-background/45">
      <div className="flex min-h-9 items-center justify-between gap-3 bg-muted/20 px-4">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          JSON schema
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {schemaType(props.value)}
        </span>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 max-h-96 min-w-max p-4 font-mono text-[12px] leading-5 text-foreground">
          <code>
            <JsonSyntax text={formatSchema(props.value)} />
          </code>
        </pre>
      </div>
    </section>
  );
}

function EmptyState(props: { title: string; message: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border/80 bg-card/35 px-6 text-center">
      <div className="grid max-w-md gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{props.title}</h2>
        <p className="m-0 text-sm leading-6 text-muted-foreground">{props.message}</p>
      </div>
    </div>
  );
}

function sourceBadgeClass(source: "static" | "dynamic"): string {
  return source === "dynamic"
    ? "border-primary/35 bg-primary/10 text-primary"
    : "border-border/80 bg-muted/55 text-muted-foreground";
}

function schemaType(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "value";
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : "object";
}

function schemaPropertyCount(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return 0;
  }
  const properties = (value as { properties?: unknown }).properties;
  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties).length
    : 0;
}

function formatSchema(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
