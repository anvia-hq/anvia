import type {
  StudioAgentMcpServerMetadata,
  StudioAgentMcpsSummary,
  StudioAgentMcpToolMetadata,
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
import { JsonSyntax } from "../shared/renderers";

export function McpsPage(props: {
  agents: StudioConfig["agents"];
  selectedAgentId: string;
  summary: StudioAgentMcpsSummary | undefined;
  enabled: boolean;
  loading: boolean;
  onSelectAgent: (agentId: string) => void;
}) {
  const selectedAgent =
    props.agents.find((agent) => agent.id === props.selectedAgentId) ?? props.agents[0];
  const servers = props.summary?.servers ?? [];
  const toolCount = servers.reduce((total, server) => total + server.toolCount, 0);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="MCPs"
    >
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className=" text-xs font-semibold uppercase tracking-[0.24em] text-foreground">
              External context
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              MCPs
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              MCP servers and remote tools registered on Studio agents, grouped by server.
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-3 max-md:grid max-md:grid-cols-1">
            <Badge className="h-9 justify-center border-border/80 bg-card/70 text-muted-foreground">
              {servers.length} servers / {toolCount} tools
            </Badge>
            {props.agents.length > 1 ? (
              <Select value={selectedAgent?.id ?? ""} onValueChange={props.onSelectAgent}>
                <SelectTrigger className="h-9 min-h-9 w-64 rounded-lg border-border bg-card/80 text-xs max-md:w-full">
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
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-4 pr-6">
        <div className="grid w-full gap-5">
          {!props.enabled ? (
            <EmptyState
              title="MCPs unavailable"
              message="No registered Studio agent exposes MCP tools."
            />
          ) : props.loading ? (
            <EmptyState title="Loading MCPs" message="Reading registered MCP metadata." />
          ) : servers.length === 0 ? (
            <EmptyState title="No MCPs" message="The selected agent has no registered MCP tools." />
          ) : (
            servers.map((server) => <McpServerSection server={server} key={server.name} />)
          )}
        </div>
      </div>
    </section>
  );
}

function McpServerSection(props: { server: StudioAgentMcpServerMetadata }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card/55 p-2 shadow-sm">
      <header className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border/60 bg-muted/20 px-4">
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 truncate text-sm font-semibold text-foreground">
            {props.server.name}
          </h2>
          <span className="truncate text-xs font-medium text-muted-foreground">
            {props.server.agentId}
          </span>
        </div>
        <Badge className="border-border/80 bg-background/50 text-muted-foreground">
          {props.server.toolCount} tools
        </Badge>
      </header>
      <div className="mt-1 grid gap-1">
        {props.server.tools.map((tool) => (
          <McpToolRow tool={tool} key={`${tool.source}:${tool.name}`} />
        ))}
      </div>
    </section>
  );
}

function McpToolRow(props: { tool: StudioAgentMcpToolMetadata }) {
  return (
    <article className="grid grid-cols-[minmax(300px,0.75fr)_minmax(0,1fr)] gap-2 rounded-lg border border-transparent bg-background/25 p-2 transition duration-200 hover:border-border/70 hover:bg-background/35 max-lg:grid-cols-1">
      <div className="grid content-start gap-4 rounded-lg bg-card/25 p-3">
        <div className="grid gap-1">
          <h3 className="m-0 truncate text-sm font-semibold text-foreground">{props.tool.name}</h3>
          <span className=" text-xs font-medium text-muted-foreground">{props.tool.source}</span>
        </div>
        <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
          {props.tool.description}
        </p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Badge className={sourceBadgeClass(props.tool.source)}>{props.tool.source}</Badge>
          <Badge className="border-border/80 bg-transparent text-muted-foreground">
            {schemaPropertyCount(props.tool.parameters)} fields
          </Badge>
        </div>
      </div>
      <SchemaBlock value={props.tool.parameters} />
    </article>
  );
}

function SchemaBlock(props: { value: unknown }) {
  return (
    <section className="grid min-w-0 content-start overflow-hidden rounded-lg bg-background/45">
      <div className="flex min-h-9 items-center justify-between gap-3 bg-muted/20 px-4">
        <span className=" text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Parameter schema
        </span>
        <span className=" text-xs text-muted-foreground">{schemaType(props.value)}</span>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 max-h-80 min-w-max p-4 text-xs leading-5 text-foreground">
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
    ? "border-border/80 bg-muted/45 text-foreground"
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
