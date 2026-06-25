import { useEffect, useMemo, useState } from "react";
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
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [runState, setRunState] = useState<"idle" | "running">("idle");
  const [runResponse, setRunResponse] = useState<StudioToolRunResponse | undefined>();
  const [runError, setRunError] = useState("");
  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? tools[0],
    [selectedToolName, tools],
  );

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
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className=" text-xs font-semibold uppercase tracking-[0.24em] text-foreground">
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
            <>
              <section className="grid gap-4 rounded-xl border border-border/80 bg-card/55 p-4 shadow-sm xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-3">
                  <div className="grid gap-1">
                    <h2 className="m-0 text-base font-semibold text-foreground">Run tool</h2>
                    <p className="m-0 text-sm leading-6 text-muted-foreground">
                      Invoke a registered tool directly with JSON arguments and inspect the raw
                      result.
                    </p>
                  </div>
                  <Select value={selectedTool?.name ?? ""} onValueChange={setSelectedToolName}>
                    <SelectTrigger className="h-9 min-h-9 rounded-lg border-border bg-background/80 text-xs">
                      <SelectValue placeholder="Tool" />
                    </SelectTrigger>
                    <SelectContent>
                      {tools.map((tool) => (
                        <SelectItem value={tool.name} key={`${tool.source}:${tool.name}`}>
                          {tool.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTool === undefined ? null : (
                    <div className="grid gap-2 rounded-lg bg-background/45 p-3">
                      <span className=" text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        selected definition
                      </span>
                      <p className="m-0 text-sm leading-6 text-muted-foreground">
                        {selectedTool.description}
                      </p>
                      <div className="flex min-w-0 flex-wrap gap-2">
                        <Badge className={sourceBadgeClass(selectedTool.source)}>
                          {selectedTool.source}
                        </Badge>
                        <Badge className="border-border/80 bg-muted/55 text-muted-foreground">
                          {schemaPropertyCount(selectedTool.parameters)} fields
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid min-w-0 gap-3">
                  <Textarea
                    className="min-h-40 resize-y rounded-lg border-border bg-background/70 p-3 text-xs leading-5"
                    value={argsText}
                    spellCheck={false}
                    onChange={(event) => setArgsText(event.target.value)}
                  />
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      Arguments must be valid JSON.
                    </span>
                    <Button
                      className="h-9 min-h-9 rounded-lg px-4 text-xs"
                      type="button"
                      disabled={runState === "running" || selectedTool === undefined}
                      onClick={() => void runSelectedTool()}
                    >
                      {runState === "running" ? "Running" : "Run"}
                    </Button>
                  </div>
                  {runError.length > 0 ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                      {runError}
                    </div>
                  ) : null}
                  {runResponse === undefined ? null : (
                    <SchemaBlock value={runResponse} title="Result" />
                  )}
                </div>
              </section>

              <div className="grid gap-1 overflow-hidden rounded-xl border border-border/80 bg-card/55 p-2 shadow-sm">
                <div className="grid min-h-10 grid-cols-[minmax(260px,0.75fr)_minmax(0,1fr)] items-center rounded-lg border border-border/60 bg-muted/20 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground max-lg:hidden">
                  <span>Definition</span>
                  <span>Parameter schema</span>
                </div>
                {tools.map((tool) => (
                  <ToolDefinitionRow tool={tool} key={`${tool.source}:${tool.name}`} />
                ))}
              </div>
            </>
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
          <h2 className="m-0 truncate text-sm font-semibold text-foreground">{props.tool.name}</h2>
          <span className="truncate text-xs font-medium text-muted-foreground">
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
                ? "border-border/80 bg-muted/45 text-foreground"
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
          <p className="m-0 rounded-lg bg-muted/45 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {props.tool.approval.reason}
          </p>
        )}
      </div>
      <SchemaBlock value={props.tool.parameters} title="JSON schema" />
    </article>
  );
}

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
