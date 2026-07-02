import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioAgentMcpServerMetadata,
  StudioAgentMcpsSummary,
  StudioAgentMcpToolMetadata,
  StudioAgentToolMetadata,
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
import {
  formatJson,
  parseStudioToolRunResponse,
  SchemaBlock,
  schemaPropertyCount,
  sourceBadgeClass,
  ToolRunner,
} from "../tools/tool-runner";

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
  const runnableTools = useMemo(() => mcpRunnableTools(servers), [servers]);
  const [selectedToolKey, setSelectedToolKey] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [runState, setRunState] = useState<"idle" | "running">("idle");
  const [runResponse, setRunResponse] = useState<StudioToolRunResponse | undefined>();
  const [runError, setRunError] = useState("");
  const selectedTool = useMemo(
    () => runnableTools.find((tool) => tool.key === selectedToolKey) ?? runnableTools[0],
    [runnableTools, selectedToolKey],
  );
  const lastSelectedToolKeyRef = useRef("");
  const runRequestIdRef = useRef(0);

  useEffect(() => {
    if (runnableTools.length === 0) {
      setSelectedToolKey("");
      return;
    }
    if (!runnableTools.some((tool) => tool.key === selectedToolKey)) {
      setSelectedToolKey(runnableTools[0]?.key ?? "");
    }
  }, [runnableTools, selectedToolKey]);

  useEffect(() => {
    const nextSelectedToolKey = selectedTool?.key ?? "";
    if (lastSelectedToolKeyRef.current === nextSelectedToolKey) {
      return;
    }
    lastSelectedToolKeyRef.current = nextSelectedToolKey;
    runRequestIdRef.current += 1;
    setArgsText("{}");
    setRunState("idle");
    setRunError("");
    setRunResponse(undefined);
  }, [selectedTool]);

  async function runSelectedTool() {
    if (selectedTool === undefined) {
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
    const runToolKey = selectedTool.key;
    const requestId = runRequestIdRef.current + 1;
    runRequestIdRef.current = requestId;
    const isCurrentRun = () =>
      runRequestIdRef.current === requestId && lastSelectedToolKeyRef.current === runToolKey;
    try {
      const response = await fetch(
        `/agents/${encodeURIComponent(selectedTool.agentId)}/tools/${encodeURIComponent(
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
      const rawBody = await response.json();
      if (!isCurrentRun()) {
        return;
      }
      const body = parseStudioToolRunResponse(rawBody);
      if (body === undefined) {
        setRunError(`Unexpected Studio tool run response: ${formatJson(rawBody)}`);
        return;
      }
      setRunResponse(body);
      if (!response.ok || body.status === "error") {
        setRunError(formatJson(body.error ?? body));
      }
    } catch (error) {
      if (isCurrentRun()) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrentRun()) {
        setRunState("idle");
      }
    }
  }

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
            servers.map((server) => (
              <McpServerSection
                selectedToolKey={selectedTool?.key ?? ""}
                server={server}
                key={server.name}
                onSelectTool={setSelectedToolKey}
              />
            ))
          )}
          {runnableTools.length === 0 ? null : (
            <ToolRunner
              argsText={argsText}
              runError={runError}
              runResponse={runResponse}
              runState={runState}
              selectedTool={selectedTool}
              onArgsTextChange={setArgsText}
              onRun={() => void runSelectedTool()}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function McpServerSection(props: {
  server: StudioAgentMcpServerMetadata;
  selectedToolKey: string;
  onSelectTool: (toolKey: string) => void;
}) {
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
          <McpToolRow
            serverName={props.server.name}
            active={props.selectedToolKey === mcpToolKey(props.server.name, tool)}
            tool={tool}
            key={`${tool.source}:${tool.name}`}
            onSelectTool={props.onSelectTool}
          />
        ))}
      </div>
    </section>
  );
}

function McpToolRow(props: {
  serverName: string;
  active: boolean;
  tool: StudioAgentMcpToolMetadata;
  onSelectTool: (toolKey: string) => void;
}) {
  const toolKey = mcpToolKey(props.serverName, props.tool);
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
        <Button
          className="h-8 min-h-8 w-fit rounded-md px-3 text-xs"
          type="button"
          variant="secondary"
          onClick={() => props.onSelectTool(toolKey)}
        >
          {props.active ? "Selected" : "Use"}
        </Button>
      </div>
      <SchemaBlock value={props.tool.parameters} title="Parameter schema" />
    </article>
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

type McpRunnableTool = StudioAgentToolMetadata & {
  key: string;
  mcpServerName: string;
};

function mcpRunnableTools(servers: StudioAgentMcpServerMetadata[]): McpRunnableTool[] {
  return servers.flatMap((server) =>
    server.tools.map((tool) => ({
      key: mcpToolKey(server.name, tool),
      agentId: server.agentId,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      source: tool.source,
      mcpServerName: server.name,
      approval: tool.approval,
    })),
  );
}

function mcpToolKey(serverName: string, tool: StudioAgentMcpToolMetadata): string {
  return `${serverName}:${tool.source}:${tool.name}`;
}
