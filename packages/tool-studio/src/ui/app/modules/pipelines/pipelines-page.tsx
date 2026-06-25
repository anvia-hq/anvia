import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PlayIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioConfig,
  StudioPipelineDetail,
  StudioPipelineLogEntry,
  StudioPipelineRunRecord,
} from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { StudioPageShell, StudioSurface, StudioTabs } from "../../components/ui/studio";
import { Textarea } from "../../components/ui/textarea";
import { formatLogMetadataText, LogMetadata } from "../shared/log-metadata";
import { JsonSyntax } from "../shared/renderers";
import {
  flowMutedForegroundColor,
  type NodeStatus,
  nodeStatusFromLogs,
  nodeTypes,
  type PipelineFlow,
  toFlow,
} from "./pipeline-flow";

export function PipelinesPage(props: {
  pipelines: StudioConfig["pipelines"];
  selectedPipelineId: string;
  detail: StudioPipelineDetail | undefined;
  logs: StudioPipelineLogEntry[];
  activeRunId: string;
  runs: StudioPipelineRunRecord[];
  enabled: boolean;
  detailLoading: boolean;
  logsLoading: boolean;
  runsLoading: boolean;
  runState: "idle" | "running";
  runInput: string;
  runOutput: string;
  theme: "light" | "dark";
  activeTab: PipelineSidebarTab;
  onSelectPipeline: (pipelineId: string) => void;
  onRunInputChange: (value: string) => void;
  onRun: () => void;
  onTabChange: (tab: PipelineSidebarTab) => void;
  onReplayRun: (runId: string) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const graph = props.detail?.graph;
  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ?? graph?.nodes[0] ?? undefined;
  const nodeStatuses = useMemo(
    () => nodeStatusFromLogs(props.logs, props.activeRunId),
    [props.logs, props.activeRunId],
  );
  const flow = useMemo(() => {
    if (graph === undefined) {
      return { nodes: [], edges: [] } satisfies PipelineFlow;
    }
    return toFlow(graph, nodeStatuses);
  }, [graph, nodeStatuses]);

  return (
    <StudioPageShell>
      <div className="grid min-h-0 min-w-0 pb-6 pr-6">
        <StudioSurface className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] max-lg:grid-cols-1">
          <div className="relative min-h-0 min-w-0 overflow-hidden border-r border-border/80 bg-card/25 max-lg:border-b max-lg:border-r-0">
            {props.detailLoading && graph === undefined ? (
              <div className="grid h-full min-h-96 place-items-center p-6">
                <div className="grid w-full max-w-lg gap-3">
                  <div className="h-4 w-40 animate-pulse rounded-lg bg-muted" />
                  <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
                  <div className="h-16 w-4/5 animate-pulse rounded-lg bg-muted/60" />
                </div>
              </div>
            ) : null}
            {!props.detailLoading && graph === undefined ? (
              <div className="grid h-full min-h-96 place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <p className="m-0 text-sm font-semibold text-foreground">
                    {props.pipelines.length === 0 ? "No pipelines" : "No pipeline selected"}
                  </p>
                  <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                    {props.pipelines.length === 0
                      ? "0 pipeline records are available in this Studio runtime."
                      : "Choose a registered pipeline to inspect its graph and runtime logs."}
                  </p>
                </div>
              </div>
            ) : null}
            {graph !== undefined ? (
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                className="pipeline-flow"
                style={
                  {
                    "--xy-edge-stroke": "var(--muted-foreground)",
                    "--xy-edge-stroke-width": "1.6",
                    "--xy-edge-stroke-selected": "var(--foreground)",
                  } as CSSProperties
                }
                fitView
                fitViewOptions={{ padding: 0.18, maxZoom: 0.96 }}
                minZoom={0.48}
                maxZoom={1.35}
                colorMode={props.theme}
                nodeTypes={nodeTypes}
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  focusable: true,
                }}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={14}
                  size={1.8}
                  color={flowMutedForegroundColor}
                  className="opacity-35"
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : null}
          </div>
          <PipelineInspectorSidebar
            pipelines={props.pipelines}
            selectedPipelineId={props.selectedPipelineId}
            detail={props.detail}
            logs={props.logs}
            runs={props.runs}
            logsLoading={props.logsLoading}
            runsLoading={props.runsLoading}
            runState={props.runState}
            runInput={props.runInput}
            runOutput={props.runOutput}
            activeTab={props.activeTab}
            selectedNode={selectedNode}
            selectedNodeStatus={
              selectedNode?.id === undefined ? undefined : nodeStatuses.get(selectedNode.id)
            }
            onSelectPipeline={(pipelineId) => {
              setSelectedNodeId(undefined);
              props.onSelectPipeline(pipelineId);
            }}
            onRunInputChange={props.onRunInputChange}
            onRun={props.onRun}
            onTabChange={props.onTabChange}
            onReplayRun={props.onReplayRun}
          />
        </StudioSurface>
      </div>
    </StudioPageShell>
  );
}

function PipelineInspectorSidebar(props: {
  pipelines: StudioConfig["pipelines"];
  selectedPipelineId: string;
  detail: StudioPipelineDetail | undefined;
  logs: StudioPipelineLogEntry[];
  runs: StudioPipelineRunRecord[];
  logsLoading: boolean;
  runsLoading: boolean;
  runState: "idle" | "running";
  runInput: string;
  runOutput: string;
  activeTab: PipelineSidebarTab;
  selectedNode: NonNullable<StudioPipelineDetail["graph"]["nodes"][number]> | undefined;
  selectedNodeStatus: NodeStatus | undefined;
  onSelectPipeline: (pipelineId: string) => void;
  onRunInputChange: (value: string) => void;
  onRun: () => void;
  onTabChange: (tab: PipelineSidebarTab) => void;
  onReplayRun: (runId: string) => void;
}) {
  const graph = props.detail?.graph;
  const graphStats =
    graph === undefined
      ? undefined
      : {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          agents: graph.nodes.filter((node) => node.kind === "agent").length,
          extractors: graph.nodes.filter((node) => node.kind === "extractor").length,
          parallel: graph.nodes.some((node) => node.kind === "parallel") ? "yes" : "no",
        };

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/70">
      <header className="grid gap-3 bg-card/35 px-4 py-4">
        <div className="grid gap-3">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 truncate text-base font-semibold tracking-tight text-foreground">
                {props.detail?.name ?? "Pipeline"}
              </h1>
              {props.detail?.description === undefined ? null : (
                <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {props.detail.description}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
              {props.logs.length}
            </span>
          </div>
          <Select value={props.selectedPipelineId} onValueChange={props.onSelectPipeline}>
            <SelectTrigger className="h-8 w-full rounded-lg border-border/80 bg-background text-xs hover:border-muted-foreground/60 focus:border-muted-foreground/70 focus:ring-muted-foreground/20">
              <SelectValue placeholder="Select pipeline" />
            </SelectTrigger>
            <SelectContent>
              {props.pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>
                  {pipeline.name ?? pipeline.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <PipelineSidebarTabs activeTab={props.activeTab} onChange={props.onTabChange} />
      </header>
      <div
        className={[
          "min-h-0 min-w-0 px-5 py-5",
          props.activeTab === "logs" ? "grid overflow-hidden" : "overflow-auto",
        ].join(" ")}
      >
        {props.activeTab === "input" ? (
          <div
            aria-labelledby={pipelineTabId("input")}
            id={pipelinePanelId("input")}
            role="tabpanel"
          >
            <PipelineInputPanel
              runInput={props.runInput}
              runState={props.runState}
              disabled={props.detail === undefined}
              onRunInputChange={props.onRunInputChange}
              onRun={props.onRun}
            />
          </div>
        ) : null}
        {props.activeTab === "metadata" ? (
          <div
            aria-labelledby={pipelineTabId("metadata")}
            id={pipelinePanelId("metadata")}
            role="tabpanel"
          >
            <PipelineMetadataPanel
              graphStats={graphStats}
              selectedNode={props.selectedNode}
              selectedNodeStatus={props.selectedNodeStatus}
            />
          </div>
        ) : null}
        {props.activeTab === "runs" ? (
          <div aria-labelledby={pipelineTabId("runs")} id={pipelinePanelId("runs")} role="tabpanel">
            <PipelineRunsPanel
              runs={props.runs}
              runOutput={props.runOutput}
              runState={props.runState}
              loading={props.runsLoading}
              onReplayRun={props.onReplayRun}
            />
          </div>
        ) : null}
        {props.activeTab === "logs" ? (
          <div aria-labelledby={pipelineTabId("logs")} id={pipelinePanelId("logs")} role="tabpanel">
            <PipelineLogsSection
              logs={props.logs}
              selectedPipelineId={props.selectedPipelineId}
              loading={props.logsLoading}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export type PipelineSidebarTab = "input" | "metadata" | "runs" | "logs";

const pipelineSidebarTabs: Array<{ id: PipelineSidebarTab; label: string }> = [
  { id: "input", label: "Input" },
  { id: "metadata", label: "Metadata" },
  { id: "runs", label: "Runs" },
  { id: "logs", label: "Logs" },
];

function PipelineSidebarTabs(props: {
  activeTab: PipelineSidebarTab;
  onChange: (tab: PipelineSidebarTab) => void;
}) {
  return (
    <StudioTabs className="grid-cols-4" role="tablist" aria-label="Pipeline sidebar">
      {pipelineSidebarTabs.map((tab) => (
        <button
          aria-controls={pipelinePanelId(tab.id)}
          aria-selected={props.activeTab === tab.id}
          className={[
            "h-8 rounded-lg px-2 text-xs font-semibold uppercase tracking-[0.1em] transition duration-200",
            props.activeTab === tab.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          ].join(" ")}
          key={tab.id}
          id={pipelineTabId(tab.id)}
          onClick={() => props.onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </StudioTabs>
  );
}

function pipelineTabId(tab: PipelineSidebarTab): string {
  return `pipeline-tab-${tab}`;
}

function pipelinePanelId(tab: PipelineSidebarTab): string {
  return `pipeline-panel-${tab}`;
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-background/55 px-2.5 py-2.5">
      <div className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums text-foreground">
        {props.value}
      </div>
    </div>
  );
}

function PipelineInputPanel(props: {
  runInput: string;
  runState: "idle" | "running";
  disabled: boolean;
  onRunInputChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className=" text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline input
          </div>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
            Provide JSON-compatible input for this pipeline run.
          </p>
        </div>
        <Button
          className="h-8 shrink-0 gap-1.5 rounded-lg border border-foreground bg-foreground px-3 text-xs font-semibold text-background shadow-none hover:border-foreground hover:bg-foreground/90 hover:text-background disabled:border-border disabled:bg-muted disabled:text-muted-foreground [&_svg]:!size-3"
          disabled={props.runState === "running" || props.disabled}
          onClick={props.onRun}
          variant="ghost"
        >
          <StudioIcon icon={PlayIcon} aria-hidden="true" />
          {props.runState === "running" ? "Running" : "Run"}
        </Button>
      </div>
      <label className="grid gap-2" htmlFor="pipeline-run-input">
        <span className=" text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          JSON
        </span>
        <Textarea
          id="pipeline-run-input"
          value={props.runInput}
          onChange={(event) => props.onRunInputChange(event.target.value)}
          className="min-h-44 resize-y rounded-lg border-border bg-card/30 text-xs leading-5 text-foreground"
          spellCheck={false}
        />
      </label>
    </section>
  );
}

function PipelineMetadataPanel(props: {
  graphStats:
    | {
        nodes: number;
        edges: number;
        agents: number;
        extractors: number;
        parallel: string;
      }
    | undefined;
  selectedNode: NonNullable<StudioPipelineDetail["graph"]["nodes"][number]> | undefined;
  selectedNodeStatus: NodeStatus | undefined;
}) {
  return (
    <section className="grid gap-5">
      {props.graphStats === undefined ? null : (
        <div className="grid grid-cols-5 gap-2">
          <Metric label="Nodes" value={String(props.graphStats.nodes)} />
          <Metric label="Edges" value={String(props.graphStats.edges)} />
          <Metric label="Agents" value={String(props.graphStats.agents)} />
          <Metric label="Extractors" value={String(props.graphStats.extractors)} />
          <Metric label="Parallel" value={props.graphStats.parallel} />
        </div>
      )}
      <NodeInspector node={props.selectedNode} status={props.selectedNodeStatus} />
    </section>
  );
}

function PipelineRunsPanel(props: {
  runs: StudioPipelineRunRecord[];
  runOutput: string;
  runState: "idle" | "running";
  loading: boolean;
  onReplayRun: (runId: string) => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className=" text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Runs
          </div>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
            Persisted pipeline executions.
          </p>
        </div>
        <Badge>{props.runState}</Badge>
      </div>
      {props.runOutput.length > 0 && props.runs.length === 0 ? (
        <PipelineRunOutputBlock title="Latest output" output={props.runOutput} />
      ) : null}
      <div className="grid gap-2">
        {props.loading && props.runs.length === 0 ? (
          <div className="grid gap-2 py-3">
            <div className="h-4 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-56 max-w-full animate-pulse rounded-lg bg-muted/60" />
          </div>
        ) : null}
        {!props.loading && props.runs.length === 0 ? (
          <div className="py-3 text-sm font-medium text-muted-foreground">
            No saved pipeline runs yet.
          </div>
        ) : null}
        {props.runs.map((run) => (
          <PipelineRunRow
            disabled={props.runState === "running"}
            run={run}
            key={run.runId}
            onReplayRun={props.onReplayRun}
          />
        ))}
      </div>
    </section>
  );
}

function PipelineRunRow(props: {
  run: StudioPipelineRunRecord;
  disabled: boolean;
  onReplayRun: (runId: string) => void;
}) {
  const output = pipelineRunOutputText(props.run);
  return (
    <article className="rounded-xl border border-border/70 bg-background/35 px-4 py-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={[
                "rounded-md border border-border/70 bg-card/60 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
                pipelineRunStatusClass(props.run.status),
              ].join(" ")}
            >
              {props.run.status}
            </span>
            <span className="min-w-0 truncate text-xs font-semibold text-foreground">
              {props.run.runId}
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <time>{formatLogTime(props.run.startedAt)}</time>
            {props.run.durationMs === undefined ? null : (
              <span className="tabular-nums">{props.run.durationMs}ms</span>
            )}
          </div>
        </div>
        <Button
          className="h-8 gap-1.5 rounded-lg border border-border/80 bg-muted/45 px-2.5 text-xs font-semibold text-foreground shadow-none hover:border-border hover:bg-muted/70 hover:text-foreground [&_svg]:!size-3"
          disabled={props.disabled || props.run.status === "running"}
          onClick={() => props.onReplayRun(props.run.runId)}
          title="Rerun this pipeline with its saved input"
          variant="ghost"
        >
          <StudioIcon icon={RefreshIcon} aria-hidden="true" />
          Rerun
        </Button>
      </div>
      <PipelineRunOutputBlock title="Output" output={output} />
    </article>
  );
}

function PipelineRunOutputBlock(props: { title: string; output: string }) {
  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className=" text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {props.title}
        </span>
        <span className=" text-xs font-medium tabular-nums text-muted-foreground">
          {props.output.length} chars
        </span>
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card/45 p-3 text-sm leading-6 text-foreground">
        {props.output.length > 0 ? <PipelineOutputText text={props.output} /> : "No output saved."}
      </pre>
    </div>
  );
}

function pipelineRunOutputText(run: StudioPipelineRunRecord): string {
  if (run.output !== undefined) {
    return typeof run.output === "string" ? run.output : JSON.stringify(run.output, null, 2);
  }
  if (run.error !== undefined) {
    return JSON.stringify(run.error, null, 2);
  }
  return "";
}

function PipelineOutputText(props: { text: string }) {
  return isStructuredOutput(props.text) ? <JsonSyntax text={props.text} /> : props.text;
}

function isStructuredOutput(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function pipelineRunStatusClass(status: StudioPipelineRunRecord["status"]): string {
  switch (status) {
    case "success":
      return "text-foreground";
    case "error":
      return "text-destructive";
    case "running":
      return "text-muted-foreground";
  }
}

function NodeInspector(props: {
  node: NonNullable<StudioPipelineDetail["graph"]["nodes"][number]> | undefined;
  status: NodeStatus | undefined;
}) {
  if (props.node === undefined) {
    return (
      <section className="text-sm font-medium text-muted-foreground">
        Select a node for details.
      </section>
    );
  }

  const metadata = Object.entries(props.node.metadata ?? {});
  return (
    <section className="grid content-start gap-5">
      <div>
        <div className=" text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Selected node
        </div>
        <h2 className="m-0 mt-2 text-lg font-semibold tracking-tight text-foreground">
          {props.node.label}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{props.node.kind}</Badge>
          {props.status === undefined ? null : <Badge>{props.status}</Badge>}
          {props.node.branchKey === undefined ? null : <Badge>{props.node.branchKey}</Badge>}
        </div>
      </div>
      {props.node.description === undefined ? null : (
        <p className="m-0 rounded-lg bg-muted/35 px-3 py-2 text-sm leading-6 text-muted-foreground">
          {props.node.description}
        </p>
      )}
      <DetailList
        items={[
          ["ID", props.node.id],
          ["Agent", props.node.agentId],
          ["Pipeline", props.node.pipelineId],
        ]}
      />
      {metadata.length > 0 ? (
        <div className="grid gap-2">
          <div className=" text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Metadata
          </div>
          <div className="grid gap-1">
            {metadata.map(([key, value]) => (
              <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2 text-xs" key={key}>
                <span className="truncate  text-muted-foreground">{key}</span>
                <span className="truncate font-medium text-foreground">
                  {formatMetadataValue(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PipelineLogsSection(props: {
  logs: StudioPipelineLogEntry[];
  selectedPipelineId: string;
  loading: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node === null || !stickToBottomRef.current) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  });

  function updateStickiness() {
    const node = scrollerRef.current;
    if (node === null) {
      return;
    }
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
  }

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className=" text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline logs
          </div>
          <div className="mt-1 truncate text-xs font-medium text-muted-foreground">
            {props.selectedPipelineId.length === 0
              ? "No active pipeline"
              : props.selectedPipelineId}
          </div>
        </div>
        <span className=" text-xs font-semibold tabular-nums text-muted-foreground">
          {props.logs.length}
        </span>
      </div>
      <div
        className="min-h-0 overflow-auto rounded-xl border border-border/65 bg-background/45 p-2 "
        ref={scrollerRef}
        onScroll={updateStickiness}
      >
        {props.selectedPipelineId.length === 0 ? (
          <div className="px-0 py-4 text-sm font-medium text-muted-foreground">
            No pipeline selected.
          </div>
        ) : null}
        {props.selectedPipelineId.length > 0 && props.loading && props.logs.length === 0 ? (
          <div className="grid gap-2 py-4">
            <div className="h-4 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-64 max-w-full animate-pulse rounded-lg bg-muted/60" />
            <div className="h-4 w-52 max-w-full animate-pulse rounded-lg bg-muted/60" />
          </div>
        ) : null}
        {props.selectedPipelineId.length > 0 && !props.loading && props.logs.length === 0 ? (
          <div className="py-4 text-sm font-medium text-muted-foreground">
            No logs yet. Run the pipeline to populate this console.
          </div>
        ) : null}
        {props.logs.map((log) => (
          <PipelineLogRow log={log} key={log.id} />
        ))}
      </div>
    </section>
  );
}

function PipelineLogRow(props: { log: StudioPipelineLogEntry }) {
  const metadataText = formatLogMetadataText(props.log.metadata, 4);
  const line = [
    formatLogTime(props.log.timestamp),
    props.log.level.toUpperCase().padEnd(5, " "),
    props.log.message,
    `${props.log.category}/${props.log.event}`,
    metadataText,
  ]
    .filter((item) => item.trim().length > 0)
    .join("  ");
  return (
    <article
      className={[
        "min-w-full rounded-lg px-3 py-1.5 text-xs leading-5 transition duration-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
      ].join(" ")}
      title={line}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <time className="shrink-0 text-muted-foreground">{formatLogTime(props.log.timestamp)}</time>
        <span className={["shrink-0 font-semibold", logLevelTextClass(props.log.level)].join(" ")}>
          {props.log.level.toUpperCase().padEnd(5, " ")}
        </span>
        <span className="min-w-0 break-words font-medium text-foreground">{props.log.message}</span>
      </div>
      <div className="mt-1 min-w-0 break-words text-muted-foreground/80">
        {props.log.category}/{props.log.event}
      </div>
      <LogMetadata metadata={props.log.metadata} limit={4} />
    </article>
  );
}

function DetailList(props: { items: Array<[string, string | undefined]> }) {
  const items = props.items.filter(([, value]) => value !== undefined && value.length > 0);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-2 rounded-xl bg-background/45 p-3">
      {items.map(([label, value]) => (
        <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2 text-xs" key={label}>
          <span className="truncate  text-muted-foreground">{label}</span>
          <span className="truncate font-medium text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Badge(props: { children: string }) {
  return (
    <span className="rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {props.children}
    </span>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
  if (typeof value === "object" && value !== null) {
    return "{...}";
  }
  return "";
}

function logLevelTextClass(level: StudioPipelineLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-muted-foreground";
    case "debug":
      return "text-muted-foreground";
    case "info":
      return "text-foreground";
  }
}
