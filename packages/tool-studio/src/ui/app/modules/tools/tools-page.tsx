import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import {
  StudioEmptyState,
  StudioHeaderMetric,
  StudioPageContent,
  StudioPageHeader,
  StudioPageShell,
} from "../../components/ui/studio";
import {
  approvalBadgeClass,
  formatJson,
  originBadgeClass,
  parseStudioToolRunResponse,
  schemaPropertyCount,
  schemaType,
  ToolMetaPill,
  ToolRunner,
  toolOriginLabel,
} from "./tool-runner";

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
  const tools = useMemo(() => props.summary?.tools ?? [], [props.summary]);
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [runState, setRunState] = useState<"idle" | "running">("idle");
  const [runResponse, setRunResponse] = useState<StudioToolRunResponse | undefined>();
  const [runError, setRunError] = useState("");
  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? tools[0],
    [selectedToolName, tools],
  );
  const selectedToolRunKey =
    selectedAgent === undefined || selectedTool === undefined
      ? ""
      : `${selectedAgent.id}:${selectedTool.name}`;
  const selectedToolRunKeyRef = useRef(selectedToolRunKey);
  const runRequestIdRef = useRef(0);
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

  useEffect(() => {
    if (selectedToolRunKeyRef.current === selectedToolRunKey) {
      return;
    }
    selectedToolRunKeyRef.current = selectedToolRunKey;
    runRequestIdRef.current += 1;
    setRunState("idle");
    setRunError("");
    setRunResponse(undefined);
  }, [selectedToolRunKey]);

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
    const runToolKey = selectedToolRunKey;
    const requestId = runRequestIdRef.current + 1;
    runRequestIdRef.current = requestId;
    const isCurrentRun = () =>
      runRequestIdRef.current === requestId && selectedToolRunKeyRef.current === runToolKey;
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
    <StudioPageShell className="grid-rows-[auto_minmax(0,1fr)]" aria-label="Tools">
      <StudioPageHeader
        title="Tools"
        description="Tool definitions registered on Studio agents, including approval policy and input schema."
        action={
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-sm:justify-start">
            <StudioHeaderMetric label="tools" value={toolTotals.total} />
            <StudioHeaderMetric label="mcp" value={toolTotals.mcp} />
            <StudioHeaderMetric label="static" value={toolTotals.static} />
            <StudioHeaderMetric label="dynamic" value={toolTotals.dynamic} />
            <StudioHeaderMetric label="approvals" value={toolTotals.approvals} />
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
            title="Tools unavailable"
            text="No registered Studio agent exposes static or dynamic tools."
          />
        ) : props.loading ? (
          <StudioEmptyState title="Loading tools" text="Reading registered tool metadata." />
        ) : tools.length === 0 ? (
          <StudioEmptyState title="No tools" text="The selected agent has no registered tools." />
        ) : (
          <div className="grid w-full gap-5">
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
          </div>
        )}
      </StudioPageContent>
    </StudioPageShell>
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
            <ToolTableHead>Origin</ToolTableHead>
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
        <Badge className={originBadgeClass(props.tool)}>{toolOriginLabel(props.tool)}</Badge>
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

function summarizeTools(tools: StudioAgentToolMetadata[]) {
  return tools.reduce(
    (totals, tool) => {
      totals.total += 1;
      if (tool.source === "dynamic") {
        totals.dynamic += 1;
      } else {
        totals.static += 1;
      }
      if (tool.mcpServerName !== undefined) {
        totals.mcp += 1;
      }
      if (tool.approval.required) {
        totals.approvals += 1;
      }
      return totals;
    },
    { approvals: 0, dynamic: 0, mcp: 0, static: 0, total: 0 },
  );
}

const selectedBadge = "border-border/80 bg-muted/45 text-foreground";
