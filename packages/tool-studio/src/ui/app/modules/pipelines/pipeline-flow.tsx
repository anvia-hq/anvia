import { type Edge, Handle, MarkerType, type Node, type NodeProps, Position } from "@xyflow/react";
import type { StudioPipelineDetail, StudioPipelineLogEntry } from "../../../../types";

export const nodeTypes = {
  pipelineStage: PipelineStageNode,
};

export type PipelineFlow = { nodes: Node[]; edges: Edge[] };

const flowEdgeColor = "var(--muted-foreground)";
const flowSelectedColor = "var(--foreground)";
const flowBackgroundColor = "var(--background)";
export const flowMutedForegroundColor = "var(--muted-foreground)";
const flowDestructiveColor = "var(--destructive)";
const flowRunningColor = "var(--foreground)";

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
        "group relative min-h-[74px] w-[210px] rounded-none border bg-card px-4 py-3 text-left shadow-[inset_0_1px_0_var(--sb-inset-highlight)] transition duration-200",
        props.selected ? "border-foreground" : "border-hair",
        status === "running" ? "translate-y-[-1px] border-foreground" : "",
        status === "completed" ? "border-muted-foreground" : "",
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
          <div className="truncate text-sm font-semibold leading-5 tracking-tight text-foreground">
            {props.data.label}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-lg"
              style={{ backgroundColor: props.data.statusColor }}
            />
            <span className=" text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {props.data.kind}
            </span>
          </div>
        </div>
        {status === undefined ? null : (
          <span
            className="rounded-lg border border-hair bg-background px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.08em]"
            style={{ color: props.data.statusColor }}
          >
            {status}
          </span>
        )}
      </div>
      {props.data.branchKey === undefined ? null : (
        <div className="mt-2 truncate text-xs text-muted-foreground">
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
    const nodePath = metadataPath(log.metadata, "nodePath");
    if (nodePath === undefined) {
      continue;
    }
    const nodeId = pipelineNodeKey(nodePath);
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
    const nodeId = pipelineNodeKey(node.path);
    const depth = depths.get(nodeId) ?? 0;
    const slot = depthSlots.get(depth) ?? 0;
    depthSlots.set(depth, slot + 1);
    const count = depthCounts.get(depth) ?? 1;
    const status = statuses.get(nodeId);
    return {
      id: nodeId,
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
    source: pipelineNodeKey(edge.source),
    target: pipelineNodeKey(edge.target),
    type: "smoothstep",
    className: "pipeline-flow-edge",
    label: edge.label,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 10,
      height: 10,
      color: flowEdgeColor,
    },
    style: {
      stroke: flowEdgeColor,
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
    depths.set(pipelineNodeKey(node.path), 0);
  }

  for (let index = 0; index < graph.nodes.length; index += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const source = pipelineNodeKey(edge.source);
      const target = pipelineNodeKey(edge.target);
      const sourceDepth = depths.get(source);
      if (sourceDepth === undefined || !depths.has(target)) {
        continue;
      }
      const nextDepth = sourceDepth + 1;
      if (nextDepth > (depths.get(target) ?? 0)) {
        depths.set(target, nextDepth);
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
      return flowEdgeColor;
    case "failed":
      return flowDestructiveColor;
    default:
      return flowSelectedColor;
  }
}

function metadataPath(
  metadata: StudioPipelineLogEntry["metadata"],
  key: string,
): string[] | undefined {
  const value = metadata?.[key];
  return Array.isArray(value) && value.every((segment) => typeof segment === "string")
    ? value
    : undefined;
}

export function pipelineNodeKey(path: readonly string[]): string {
  return JSON.stringify(path);
}
