import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  StudioAgentToolMetadata,
  StudioAgentToolsSummary,
  StudioConfig,
  StudioToolRunResponse,
} from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
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
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [runState, setRunState] = useState<"idle" | "running">("idle");
  const [runResponse, setRunResponse] = useState<StudioToolRunResponse | undefined>();
  const [runError, setRunError] = useState("");
  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? tools[0],
    [selectedToolName, tools],
  );
  const toolTotals = summarizeTools(tools);

  useEffect(() => {
    if (tools.length === 0) {
      setSelectedToolName("");
      return;
    }
    if (!tools.some((tool) => tool.name === selectedToolName)) {
      setSelectedToolName(tools[0]?.name ?? "");
    }
  }, [selectedToolName, tools]);

  async function runSelectedTool() {
    if (selectedAgent === undefined || selectedTool === undefined) {
      return;
    }
    let args: unknown;
    try {
      args = JSON.parse(argsText);
    } catch (parseError) {
      setRunError(parseError instanceof Error ? parseError.message : String(parseError));
      setRunResponse(undefined);
      return;
    }

    setRunState("running");
    setRunError("");
    setRunResponse(undefined);
    try {
      const response = await fetch(
        `/agents/${encodeURIComponent(selectedAgent.id)}/tools/${encodeURIComponent(
          selectedTool.name,
        )}/runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ args }),
        },
      );
      const body = (await response.json()) as StudioToolRunResponse;
      setRunResponse(body);
      if (!response.ok || body.status === "error") {
        setRunError(formatJson(body.error ?? body));
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunState("idle");
    }
  }

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Tools"
    >
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Tools
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Tool definitions registered on Studio agents, including approval policy and input
              schema.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
            <HeaderMetric label="tools" value={toolTotals.total} />
            <HeaderMetric label="static" value={toolTotals.static} />
            <HeaderMetric label="dynamic" value={toolTotals.dynamic} />
            <HeaderMetric label="approvals" value={toolTotals.approvals} />
            {props.agents.length > 1 ? (
              <Select value={selectedAgent?.id ?? ""} onValueChange={props.onSelectAgent}>
                <SelectTrigger className="h-8 min-h-8 w-64 rounded-md border-border bg-background/45 text-xs max-md:w-full">
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
              title="Tools unavailable"
              message="No registered Studio agent exposes static or dynamic tools."
            />
          ) : props.loading ? (
            <EmptyState title="Loading tools" message="Reading registered tool metadata." />
          ) : tools.length === 0 ? (
            <EmptyState title="No tools" message="The selected agent has no registered tools." />
          ) : (
            <>
              <ToolRegistryTable
                selectedToolName={selectedTool?.name ?? ""}
                tools={tools}
                onSelectTool={setSelectedToolName}
              />
              <ToolRunner
                argsText={argsText}
                runError={runError}
                runResponse={runResponse}
                runState={runState}
                selectedTool={selectedTool}
                onArgsTextChange={setArgsText}
                onRun={() => void runSelectedTool()}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ToolRegistryTable(props: {
  tools: StudioAgentToolMetadata[];
  selectedToolName: string;
  onSelectTool: (toolName: string) => void;
}) {
  return (
    <div className="min-w-[1040px]">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr>
            <ToolTableHead>Tool</ToolTableHead>
            <ToolTableHead>Source</ToolTableHead>
            <ToolTableHead>Schema</ToolTableHead>
            <ToolTableHead>Approval</ToolTableHead>
            <ToolTableHead>Run</ToolTableHead>
          </tr>
        </thead>
        <tbody>
          {props.tools.map((tool) => (
            <ToolRegistryRow
              active={props.selectedToolName === tool.name}
              key={`${tool.source}:${tool.name}`}
              tool={tool}
              onSelectTool={props.onSelectTool}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolRegistryRow(props: {
  tool: StudioAgentToolMetadata;
  active: boolean;
  onSelectTool: (toolName: string) => void;
}) {
  const propertyCount = schemaPropertyCount(props.tool.parameters);
  return (
    <tr>
      <ToolTableCell>
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {props.tool.name}
            </span>
            {props.active ? <Badge className={selectedBadge}>selected</Badge> : null}
          </div>
          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            {props.tool.agentId}
          </span>
          <p className="m-0 max-w-[64ch] truncate text-sm leading-6 text-muted-foreground">
            {props.tool.description}
          </p>
        </div>
      </ToolTableCell>
      <ToolTableCell>
        <Badge className={sourceBadgeClass(props.tool.source)}>{props.tool.source}</Badge>
      </ToolTableCell>
      <ToolTableCell>
        <div className="flex min-w-0 flex-wrap gap-2">
          <ToolMetaPill>{schemaType(props.tool.parameters)}</ToolMetaPill>
          <ToolMetaPill>
            {propertyCount} {propertyCount === 1 ? "field" : "fields"}
          </ToolMetaPill>
        </div>
      </ToolTableCell>
      <ToolTableCell>
        <div className="grid min-w-0 gap-1.5">
          <Badge className={approvalBadgeClass(props.tool.approval.required)}>
            {props.tool.approval.required ? "required" : "none"}
          </Badge>
          {props.tool.approval.reason === undefined ? null : (
            <span
              className="max-w-[280px] truncate text-xs leading-5 text-muted-foreground"
              title={props.tool.approval.reason}
            >
              {props.tool.approval.reason}
            </span>
          )}
        </div>
      </ToolTableCell>
      <ToolTableCell>
        <Button
          className="h-8 min-h-8 rounded-md px-3 text-xs"
          type="button"
          variant={props.active ? "secondary" : "ghost"}
          onClick={() => props.onSelectTool(props.tool.name)}
        >
          {props.active ? "Selected" : "Use"}
        </Button>
      </ToolTableCell>
    </tr>
  );
}

function ToolRunner(props: {
  selectedTool: StudioAgentToolMetadata | undefined;
  argsText: string;
  runState: "idle" | "running";
  runError: string;
  runResponse: StudioToolRunResponse | undefined;
  onArgsTextChange: (value: string) => void;
  onRun: () => void;
}) {
  const propertyCount =
    props.selectedTool === undefined ? 0 : schemaPropertyCount(props.selectedTool.parameters);
  return (
    <section className="grid gap-4 border-t border-border/80 pt-4 xl:grid-cols-[minmax(260px,0.42fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <h2 className="m-0 text-base font-semibold text-foreground">Runner</h2>
          {props.selectedTool === undefined ? (
            <p className="m-0 text-sm leading-6 text-muted-foreground">No tool selected</p>
          ) : (
            <>
              <p className="m-0 break-all text-sm font-semibold leading-6 text-foreground">
                {props.selectedTool.name}
              </p>
              <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                {props.selectedTool.description}
              </p>
            </>
          )}
        </div>
        {props.selectedTool === undefined ? null : (
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge className={sourceBadgeClass(props.selectedTool.source)}>
              {props.selectedTool.source}
            </Badge>
            <Badge className={approvalBadgeClass(props.selectedTool.approval.required)}>
              approval {props.selectedTool.approval.required ? "required" : "none"}
            </Badge>
            <ToolMetaPill>
              {propertyCount} {propertyCount === 1 ? "field" : "fields"}
            </ToolMetaPill>
          </div>
        )}
        {props.selectedTool?.approval.reason === undefined ? null : (
          <p className="m-0 border-l border-border/80 pl-3 text-xs leading-5 text-muted-foreground">
            {props.selectedTool.approval.reason}
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-3">
        <Textarea
          className="min-h-36 resize-y rounded-md border-border bg-background/45 p-3 text-xs leading-5"
          value={props.argsText}
          spellCheck={false}
          onChange={(event) => props.onArgsTextChange(event.target.value)}
        />
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            Arguments must be valid JSON.
          </span>
          <Button
            className="h-8 min-h-8 rounded-md px-4 text-xs"
            type="button"
            disabled={props.runState === "running" || props.selectedTool === undefined}
            onClick={props.onRun}
          >
            {props.runState === "running" ? "Running" : "Run"}
          </Button>
        </div>
        {props.runError.length > 0 ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
            {props.runError}
          </div>
        ) : null}
        {props.selectedTool === undefined ? null : (
          <details className="group border-t border-border/70 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
              Parameter schema
              <span className="font-medium normal-case tracking-normal">
                {schemaType(props.selectedTool.parameters)}
              </span>
            </summary>
            <div className="mt-3">
              <SchemaBlock value={props.selectedTool.parameters} title="JSON schema" />
            </div>
          </details>
        )}
        {props.runResponse === undefined ? null : (
          <SchemaBlock value={props.runResponse} title="Result" />
        )}
      </div>
    </section>
  );
}

function ToolTableHead(props: { children: string }) {
  return (
    <th className="border-b border-border/80 py-2.5 pr-5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground first:pl-0">
      {props.children}
    </th>
  );
}

function ToolTableCell(props: { children: ReactNode }) {
  return (
    <td className="border-b border-border/70 py-3.5 pr-5 align-top first:pl-0">{props.children}</td>
  );
}

function ToolMetaPill(props: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-md bg-muted/25 px-2.5 text-xs font-medium text-muted-foreground">
      {props.children}
    </span>
  );
}

function HeaderMetric(props: { label: string; value: number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/45 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

function summarizeTools(tools: StudioAgentToolMetadata[]) {
  return tools.reduce(
    (totals, tool) => {
      totals.total += 1;
      if (tool.source === "dynamic") {
        totals.dynamic += 1;
      } else {
        totals.static += 1;
      }
      if (tool.approval.required) {
        totals.approvals += 1;
      }
      return totals;
    },
    { approvals: 0, dynamic: 0, static: 0, total: 0 },
  );
}

function approvalBadgeClass(required: boolean): string {
  return required
    ? "border-border/80 bg-muted/35 text-foreground"
    : "border-transparent bg-transparent text-muted-foreground/60";
}

const selectedBadge = "border-border/80 bg-muted/45 text-foreground";

function SchemaBlock(props: { value: unknown; title: string }) {
  return (
    <section className="grid min-w-0 content-start overflow-hidden rounded-lg bg-background/45">
      <div className="flex min-h-9 items-center justify-between gap-3 bg-muted/20 px-4">
        <span className=" text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {props.title}
        </span>
        <span className=" text-xs text-muted-foreground">{schemaType(props.value)}</span>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 max-h-96 min-w-max p-4 text-xs leading-5 text-foreground">
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
