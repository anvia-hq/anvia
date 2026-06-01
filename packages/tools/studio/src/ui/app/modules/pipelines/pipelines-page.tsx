import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowClockwise, Play } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioConfig,
  StudioPipelineDetail,
  StudioPipelineLogEntry,
  StudioPipelineRunRecord,
} from "../../../../types";
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

const nodeTypes = {
  pipelineStage: PipelineStageNode,
};

const flowPrimaryColor = "var(--primary)";
const flowBackgroundColor = "var(--background)";
const flowMutedForegroundColor = "var(--muted-foreground)";
const flowDestructiveColor = "var(--destructive)";
const flowRunningColor = "hsl(38 96% 56%)";

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
  onSelectPipeline: (pipelineId: string) => void;
  onRunInputChange: (value: string) => void;
  onRun: () => void;
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
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }
    return toFlow(graph, nodeStatuses);
  }, [graph, nodeStatuses]);

  if (!props.enabled) {
    return (
      <section className="grid min-h-0 place-items-center p-8 text-center">
        <div className="grid max-w-lg gap-3">
          <h1 className="m-0 text-2xl font-semibold text-foreground">Pipelines unavailable</h1>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            This Studio runner has no registered pipelines.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-0 min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] overflow-hidden bg-background/45 max-lg:grid-cols-1">
      <div className="relative min-h-0 min-w-0 overflow-hidden bg-card/25">
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
              <p className="m-0 text-sm font-semibold text-foreground">No pipeline selected</p>
              <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                Choose a registered pipeline to inspect its graph and runtime logs.
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
                "--xy-edge-stroke": "var(--primary)",
                "--xy-edge-stroke-width": "1.6",
                "--xy-edge-stroke-selected": "var(--primary)",
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
        onReplayRun={props.onReplayRun}
      />
    </section>
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
  selectedNode: NonNullable<StudioPipelineDetail["graph"]["nodes"][number]> | undefined;
  selectedNodeStatus: NodeStatus | undefined;
  onSelectPipeline: (pipelineId: string) => void;
  onRunInputChange: (value: string) => void;
  onRun: () => void;
  onReplayRun: (runId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<PipelineSidebarTab>("input");
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
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l border-border/80 bg-background/70 max-lg:border-l-0 max-lg:border-t">
      <header className="grid gap-3 border-b border-border/80 bg-card/35 px-4 py-4">
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
            <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
              {props.logs.length}
            </span>
          </div>
          <Select value={props.selectedPipelineId} onValueChange={props.onSelectPipeline}>
            <SelectTrigger className="h-8 w-full rounded-lg border-primary/55 bg-background font-mono text-[11px] hover:border-primary focus:border-primary focus:ring-primary/25">
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
        <PipelineSidebarTabs activeTab={activeTab} onChange={setActiveTab} />
      </header>
      <div
        className={[
          "min-h-0 min-w-0 px-5 py-5",
          activeTab === "logs" ? "grid overflow-hidden" : "overflow-auto",
        ].join(" ")}
      >
        {activeTab === "input" ? (
          <PipelineInputPanel
            runInput={props.runInput}
            runState={props.runState}
            disabled={props.detail === undefined}
            onRunInputChange={props.onRunInputChange}
            onRun={props.onRun}
          />
        ) : null}
        {activeTab === "metadata" ? (
          <PipelineMetadataPanel
            graphStats={graphStats}
            selectedNode={props.selectedNode}
            selectedNodeStatus={props.selectedNodeStatus}
          />
        ) : null}
        {activeTab === "runs" ? (
          <PipelineRunsPanel
            runs={props.runs}
            runOutput={props.runOutput}
            runState={props.runState}
            loading={props.runsLoading}
            onReplayRun={props.onReplayRun}
          />
        ) : null}
        {activeTab === "logs" ? (
          <PipelineLogsSection
            logs={props.logs}
            selectedPipelineId={props.selectedPipelineId}
            loading={props.logsLoading}
          />
        ) : null}
      </div>
    </aside>
  );
}

type PipelineSidebarTab = "input" | "metadata" | "runs" | "logs";

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
    <div
      className="grid grid-cols-4 gap-1 rounded-xl border border-border/80 bg-background p-1"
      role="tablist"
      aria-label="Pipeline sidebar"
    >
      {pipelineSidebarTabs.map((tab) => (
        <button
          aria-selected={props.activeTab === tab.id}
          className={[
            "h-8 rounded-lg px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition duration-200",
            props.activeTab === tab.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          ].join(" ")}
          key={tab.id}
          onClick={() => props.onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-background/55 px-2.5 py-2.5">
      <div className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 truncate font-mono text-base font-semibold tabular-nums text-foreground">
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
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline input
          </div>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
            Provide JSON-compatible input for this pipeline run.
          </p>
        </div>
        <Button
          className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold"
          disabled={props.runState === "running" || props.disabled}
          onClick={props.onRun}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {props.runState === "running" ? "Running" : "Run"}
        </Button>
      </div>
      <label className="grid gap-2" htmlFor="pipeline-run-input">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          JSON
        </span>
        <Textarea
          id="pipeline-run-input"
          value={props.runInput}
          onChange={(event) => props.onRunInputChange(event.target.value)}
          className="min-h-44 resize-y rounded-lg border-border bg-card/30 font-mono text-xs leading-5 text-foreground"
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
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
    <article className="grid gap-3 rounded-lg border border-border/80 bg-card/25 p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-mono text-[11px] font-semibold text-foreground">
          {props.run.runId}
        </span>
        <span
          className={[
            "shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
            pipelineRunStatusClass(props.run.status),
          ].join(" ")}
        >
          {props.run.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{formatLogTime(props.run.startedAt)}</span>
        <span className="truncate text-right tabular-nums">
          {props.run.durationMs === undefined ? "" : `${props.run.durationMs}ms`}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-end">
        <Button
          className="h-7 rounded-lg px-2.5 text-[11px] font-semibold"
          disabled={props.disabled || props.run.status === "running"}
          onClick={() => props.onReplayRun(props.run.runId)}
          title="Replay this run with its saved input"
          variant="secondary"
        >
          <ArrowClockwise className="mr-1.5 h-3.5 w-3.5" />
          Replay
        </Button>
      </div>
      <PipelineRunOutputBlock title="Output" output={output} />
    </article>
  );
}

function PipelineRunOutputBlock(props: { title: string; output: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {props.title}
        </span>
        <span className="font-mono text-[9px] font-medium tabular-nums text-muted-foreground">
          {props.output.length} bytes
        </span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-background/55 p-3 font-mono text-xs leading-5 text-foreground">
        {props.output.length > 0 ? <JsonSyntax text={props.output} /> : "No output saved."}
      </pre>
    </div>
  );
}

function pipelineRunOutputText(run: StudioPipelineRunRecord): string {
  if (run.output !== undefined) {
    return JSON.stringify(run.output, null, 2);
  }
  if (run.error !== undefined) {
    return JSON.stringify(run.error, null, 2);
  }
  return "";
}

function pipelineRunStatusClass(status: StudioPipelineRunRecord["status"]): string {
  switch (status) {
    case "success":
      return "text-primary";
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
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
        <p className="m-0 rounded-lg bg-primary/10 px-3 py-2 text-sm leading-6 text-muted-foreground">
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
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Metadata
          </div>
          <div className="grid gap-1">
            {metadata.map(([key, value]) => (
              <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2 text-xs" key={key}>
                <span className="truncate font-mono text-muted-foreground">{key}</span>
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
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline logs
          </div>
          <div className="mt-1 truncate font-mono text-[11px] font-medium text-muted-foreground">
            {props.selectedPipelineId.length === 0
              ? "No active pipeline"
              : props.selectedPipelineId}
          </div>
        </div>
        <span className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
          {props.logs.length}
        </span>
      </div>
      <div
        className="min-h-0 overflow-auto rounded-xl border border-border/65 bg-background/45 p-2 font-mono"
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
  const metadata = Object.entries(props.log.metadata ?? {}).slice(0, 4);
  const metadataText = metadata
    .map(([key, value]) => `${key}=${formatMetadataValue(value)}`)
    .join(" ");
  return (
    <article
      className={[
        "w-max min-w-full whitespace-nowrap rounded-lg border-l-2 px-3 py-1.5 text-[11px] leading-5 transition duration-200 hover:bg-accent/45",
        logLevelBorderClass(props.log.level),
      ].join(" ")}
    >
      <time className="text-muted-foreground">{formatLogTime(props.log.timestamp)}</time>
      <span className={["ml-3 font-semibold", logLevelTextClass(props.log.level)].join(" ")}>
        {props.log.level.toUpperCase().padEnd(5, " ")}
      </span>
      <span className="ml-3 text-muted-foreground">
        {props.log.category}/{props.log.event}
      </span>
      <span className="ml-3 font-medium text-foreground">{props.log.message}</span>
      <span className="ml-3 text-muted-foreground/85">{metadataText}</span>
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
          <span className="truncate font-mono text-muted-foreground">{label}</span>
          <span className="truncate font-medium text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Badge(props: { children: string }) {
  return (
    <span className="rounded-lg border border-border/70 bg-background/70 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {props.children}
    </span>
  );
}

type PipelineNodeData = {
  label: string;
  kind: StudioPipelineDetail["graph"]["nodes"][number]["kind"];
  status: NodeStatus | undefined;
  statusColor: string;
  branchKey: string | undefined;
};

function PipelineStageNode(props: NodeProps<Node<PipelineNodeData>>) {
  const status = props.data.status;
  return (
    <article
      className={[
        "group relative min-h-[74px] w-[210px] rounded-xl border bg-card px-4 py-3 text-left shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)] transition duration-200",
        props.selected ? "border-primary" : "border-border/80",
        status === "running" ? "translate-y-[-1px] border-amber-400" : "",
        status === "completed" ? "border-primary/70" : "",
        status === "failed" ? "border-destructive" : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-0 !w-0 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-5 tracking-tight text-foreground">
            {props.data.label}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-lg"
              style={{ backgroundColor: props.data.statusColor }}
            />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {props.data.kind}
            </span>
          </div>
        </div>
        {status === undefined ? null : (
          <span
            className="rounded-lg border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: props.data.statusColor }}
          >
            {status}
          </span>
        )}
      </div>
      {props.data.branchKey === undefined ? null : (
        <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
          branch: {props.data.branchKey}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-0 !w-0 !border-0 !bg-transparent !opacity-0"
      />
    </article>
  );
}

type NodeStatus = "running" | "completed" | "failed";

function nodeStatusFromLogs(
  logs: StudioPipelineLogEntry[],
  activeRunId: string,
): Map<string, NodeStatus> {
  const statuses = new Map<string, NodeStatus>();
  if (activeRunId.length === 0) {
    return statuses;
  }
  for (const log of logs) {
    if (log.runId !== activeRunId) {
      continue;
    }
    const nodeId = metadataString(log.metadata, "nodeId");
    if (nodeId === undefined) {
      continue;
    }
    if (log.event.endsWith(".started")) {
      statuses.set(nodeId, "running");
    }
    if (log.event.endsWith(".completed")) {
      statuses.set(nodeId, "completed");
    }
    if (log.event.endsWith(".failed")) {
      statuses.set(nodeId, "failed");
    }
  }
  return statuses;
}

function toFlow(
  graph: StudioPipelineDetail["graph"],
  statuses: Map<string, NodeStatus>,
): { nodes: Node[]; edges: Edge[] } {
  const depths = nodeDepths(graph);
  const depthSlots = new Map<number, number>();
  const depthCounts = new Map<number, number>();
  for (const depth of depths.values()) {
    depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
  }

  const nodes: Node[] = graph.nodes.map((node) => {
    const depth = depths.get(node.id) ?? 0;
    const slot = depthSlots.get(depth) ?? 0;
    depthSlots.set(depth, slot + 1);
    const count = depthCounts.get(depth) ?? 1;
    const status = statuses.get(node.id);
    return {
      id: node.id,
      type: "pipelineStage",
      position: {
        x: (slot - (count - 1) / 2) * 280,
        y: depth * 170,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        label: node.label,
        kind: node.kind,
        status,
        statusColor: statusColor(status),
        branchKey: node.branchKey,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    className: "pipeline-flow-edge",
    label: edge.label,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 10,
      height: 10,
      color: flowPrimaryColor,
    },
    style: {
      stroke: flowPrimaryColor,
      strokeWidth: 1.6,
      opacity: 0.78,
    },
    labelShowBg: true,
    labelStyle: {
      fill: flowMutedForegroundColor,
      fontSize: 11,
      fontWeight: 700,
    },
    labelBgStyle: {
      fill: flowBackgroundColor,
      fillOpacity: 0.92,
    },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 2,
  }));

  return { nodes, edges };
}

function nodeDepths(graph: StudioPipelineDetail["graph"]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const node of graph.nodes) {
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    const depth =
      incoming.length === 0
        ? 0
        : Math.max(...incoming.map((edge) => (depths.get(edge.source) ?? 0) + 1));
    depths.set(node.id, depth);
  }
  return depths;
}

function statusColor(status: NodeStatus | undefined): string {
  switch (status) {
    case "running":
      return flowRunningColor;
    case "completed":
      return flowPrimaryColor;
    case "failed":
      return flowDestructiveColor;
    default:
      return flowPrimaryColor;
  }
}

function metadataString(
  metadata: StudioPipelineLogEntry["metadata"],
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
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

function logLevelBorderClass(level: StudioPipelineLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "border-destructive";
    case "warn":
      return "border-muted-foreground";
    case "debug":
      return "border-muted-foreground/45";
    case "info":
      return "border-primary/70";
  }
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
      return "text-primary";
  }
}
