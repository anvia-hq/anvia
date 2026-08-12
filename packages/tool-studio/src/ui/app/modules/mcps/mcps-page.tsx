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
  StudioEmptyState,
  StudioHeaderMetric,
  StudioPageContent,
  StudioPageHeader,
  StudioPageShell,
} from "../../components/ui/studio";
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
    <StudioPageShell className="grid-rows-[auto_minmax(0,1fr)]" aria-label="MCPs">
      <StudioPageHeader
        title="MCPs"
        description="MCP servers and remote tools registered on Studio agents, grouped by server."
        action={
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-sm:justify-start">
            <StudioHeaderMetric label="servers" value={servers.length} />
            <StudioHeaderMetric label="tools" value={toolCount} />
            {props.agents.length > 1 ? (
              <Select value={selectedAgent?.id ?? ""} onValueChange={props.onSelectAgent}>
                <SelectTrigger className="h-8 min-h-8 w-64 rounded-md border-border text-xs max-sm:w-full">
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
        }
      />

      <StudioPageContent className="overflow-auto">
        {!props.enabled ? (
          <StudioEmptyState
            title="MCPs unavailable"
            text="No registered Studio agent exposes MCP tools."
          />
        ) : props.loading ? (
          <StudioEmptyState title="Loading MCPs" text="Reading registered MCP metadata." />
        ) : servers.length === 0 ? (
          <StudioEmptyState
            title="No MCPs"
            text="The selected agent has no registered MCP tools."
          />
        ) : (
          <div className="grid w-full gap-5">
            {servers.map((server) => (
              <McpServerSection
                selectedToolKey={selectedTool?.key ?? ""}
                server={server}
                key={server.name}
                onSelectTool={setSelectedToolKey}
              />
            ))}
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
        )}
      </StudioPageContent>
    </StudioPageShell>
  );
}

function McpServerSection(props: {
  server: StudioAgentMcpServerMetadata;
  selectedToolKey: string;
  onSelectTool: (toolKey: string) => void;
}) {
  return (
    <section className="overflow-hidden border-t">
      <header className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b bg-muted/20 px-4">
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
