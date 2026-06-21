import { type Edge, Handle, MarkerType, type Node, type NodeProps, Position } from "@xyflow/react";
import type { StudioPipelineDetail, StudioPipelineLogEntry } from "../../../../types";

export const nodeTypes = {
  pipelineStage: PipelineStageNode,
};

export type PipelineFlow = { nodes: Node[]; edges: Edge[] };

const flowPrimaryColor = "var(--primary)";
const flowBackgroundColor = "var(--background)";
export const flowMutedForegroundColor = "var(--muted-foreground)";
const flowDestructiveColor = "var(--destructive)";
const flowRunningColor = "hsl(38 96% 56%)";

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

export type NodeStatus = "running" | "completed" | "failed";

export function nodeStatusFromLogs(
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

export function toFlow(
  graph: StudioPipelineDetail["graph"],
  statuses: Map<string, NodeStatus>,
): PipelineFlow {
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
    depths.set(node.id, 0);
  }

  for (let index = 0; index < graph.nodes.length; index += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const sourceDepth = depths.get(edge.source);
      if (sourceDepth === undefined || !depths.has(edge.target)) {
        continue;
      }
      const nextDepth = sourceDepth + 1;
      if (nextDepth > (depths.get(edge.target) ?? 0)) {
        depths.set(edge.target, nextDepth);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
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
