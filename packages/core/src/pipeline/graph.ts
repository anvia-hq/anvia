import type { JsonObject } from "../completion";
import { compact } from "../internal/compact";
import type {
  PipelineBuilderState,
  PipelineGraph,
  PipelineGraphNode,
  PipelineMetadata,
  PipelineStageKind,
} from "./types";

export function initialBuilderState(metadata: PipelineMetadata): PipelineBuilderState {
  return {
    graph: initialGraph(metadata),
    terminalNodeId: "input",
    terminalNodeIds: ["input"],
    nextNodeIndex: 1,
    nextEdgeIndex: 1,
  };
}

export function initialGraph(metadata: PipelineMetadata): PipelineGraph {
  const id = normalizeId(metadata.id ?? "pipeline");
  return {
    ...compact({
      id,
      name: metadata.name,
      description: metadata.description,
      metadata: metadata.metadata,
    }),
    nodes: [{ id: "input", kind: "input", label: "Input" }],
    edges: [],
  };
}

export function appendNode(
  state: PipelineBuilderState,
  kind: PipelineStageKind,
  label: string,
  options: {
    description?: string | undefined;
    metadata?: JsonObject | undefined;
    preferredId?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
  } = {},
): { state: PipelineBuilderState; node: PipelineGraphNode } {
  const node = graphNode(kind, label, state.nextNodeIndex, {
    ...options,
    existingIds: new Set(state.graph.nodes.map((item) => item.id)),
  });
  return {
    node,
    state: appendGraphNode(state, node, activeTerminalNodeIds(state), [node.id]),
  };
}

export function appendChildNode(
  state: PipelineBuilderState,
  parentId: string,
  kind: PipelineStageKind,
  label: string,
  options: {
    branchKey?: string | undefined;
  } = {},
): { state: PipelineBuilderState; node: PipelineGraphNode } {
  const node = graphNode(kind, label, state.nextNodeIndex, {
    ...options,
    existingIds: new Set(state.graph.nodes.map((item) => item.id)),
  });
  return {
    node,
    state: appendGraphNode(state, node, [parentId], activeTerminalNodeIds(state)),
  };
}

export function activeTerminalNodeIds(state: PipelineBuilderState): string[] {
  return state.terminalNodeIds.length > 0 ? state.terminalNodeIds : [state.terminalNodeId];
}

export function withTerminalNodes(
  state: PipelineBuilderState,
  terminalNodeIds: string[],
): PipelineBuilderState {
  return {
    ...state,
    terminalNodeId: terminalNodeIds.at(-1) ?? state.terminalNodeId,
    terminalNodeIds,
  };
}

export function withOutputNode(state: PipelineBuilderState): PipelineGraph {
  const graph = cloneGraph(state.graph);
  if (graph.nodes.some((node) => node.id === "output")) {
    return graph;
  }
  graph.nodes.push({ id: "output", kind: "output", label: "Output" });
  graph.edges.push(
    ...activeTerminalNodeIds(state).map((sourceId, index) => ({
      id: `edge_${state.nextEdgeIndex + index}`,
      source: sourceId,
      target: "output",
    })),
  );
  return graph;
}

export function nextStageLabel(state: PipelineBuilderState, prefix: string): string {
  return `${prefix} ${state.nextNodeIndex}`;
}

export function cloneGraph(graph: PipelineGraph): PipelineGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function appendGraphNode(
  state: PipelineBuilderState,
  node: PipelineGraphNode,
  sourceIds: string[],
  terminalNodeIds: string[],
): PipelineBuilderState {
  const edges = sourceIds.map((sourceId, index) => ({
    id: `edge_${state.nextEdgeIndex + index}`,
    source: sourceId,
    target: node.id,
  }));
  const terminalNodeId = terminalNodeIds.at(-1) ?? state.terminalNodeId;
  return {
    graph: {
      ...state.graph,
      nodes: [...state.graph.nodes, node],
      edges: [...state.graph.edges, ...edges],
    },
    terminalNodeId,
    terminalNodeIds,
    nextNodeIndex: state.nextNodeIndex + 1,
    nextEdgeIndex: state.nextEdgeIndex + edges.length,
  };
}

function graphNode(
  kind: PipelineStageKind,
  label: string,
  index: number,
  options: {
    description?: string | undefined;
    metadata?: JsonObject | undefined;
    preferredId?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
    branchKey?: string | undefined;
    existingIds?: Set<string> | undefined;
  } = {},
): PipelineGraphNode {
  const id = uniqueGraphNodeId(
    normalizeId(options.preferredId ?? `${kind}_${index}`),
    options.existingIds ?? new Set(),
  );
  return compact({
    id,
    kind,
    label,
    description: options.description,
    metadata: options.metadata,
    agentId: options.agentId,
    agentName: options.agentName,
    pipelineId: options.pipelineId,
    branchKey: options.branchKey,
  }) as PipelineGraphNode;
}

function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length === 0 ? "pipeline" : normalized;
}

function uniqueGraphNodeId(baseId: string, existingIds: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return id;
}
