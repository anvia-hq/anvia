import type { JsonObject } from "../completion";
import type {
  PipelineGraph,
  PipelineGraphEdge,
  PipelineGraphNode,
  PipelineNodePath,
  PipelineStageKind,
  PipelineStageMetadata,
  PipelineState,
} from "./types";

const INPUT_ID = "$input";
const OUTPUT_ID = "$output";
const RESERVED_STAGE_IDS = new Set([INPUT_ID, OUTPUT_ID]);

export function initialPipelineState(options: {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
}): PipelineState {
  const input = graphNode(INPUT_ID, [INPUT_ID], "input", "Input");
  const graph: PipelineGraph = {
    id: options.id,
    nodes: [input],
    edges: [],
  };
  if (options.name !== undefined) graph.name = options.name;
  if (options.description !== undefined) graph.description = options.description;
  if (options.metadata !== undefined) graph.metadata = options.metadata;
  return {
    graph,
    terminalPaths: [input.path],
    stageIds: new Set(),
    nextEdgeIndex: 1,
  };
}

export function appendStageNode(
  state: PipelineState,
  kind: PipelineStageKind,
  stage: PipelineStageMetadata,
  options: {
    defaultLabel?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
  } = {},
): { state: PipelineState; node: PipelineGraphNode } {
  const id = validateStageId(stage.id);
  if (state.stageIds.has(id)) {
    throw new TypeError(`Pipeline stage id "${id}" is already registered.`);
  }
  const node = graphNode(id, [id], kind, stage.name ?? options.defaultLabel ?? id, {
    description: stage.description,
    metadata: stage.metadata,
    agentId: options.agentId,
    agentName: options.agentName,
    pipelineId: options.pipelineId,
  });
  return {
    node,
    state: appendNode(state, node, state.terminalPaths, [node.path], id),
  };
}

export function appendComposedGraph(
  state: PipelineState,
  boundary: PipelineGraphNode,
  child: PipelineGraph,
): PipelineState {
  return appendChildGraph(state, boundary.path, child);
}

export function appendParallelBranch(
  state: PipelineState,
  parallel: PipelineGraphNode,
  branchKey: string,
  child: PipelineGraph,
): { state: PipelineState; node: PipelineGraphNode; terminalPaths: PipelineNodePath[] } {
  const id = validateStageId(branchKey);
  const path = [...parallel.path, id];
  const node = graphNode(id, path, "branch", id, { branchKey: id, pipelineId: child.id });
  const withBranch = appendNode(state, node, [parallel.path], state.terminalPaths);
  const withChild = appendChildGraph(withBranch, node.path, child);
  return { state: withChild, node, terminalPaths: withChild.terminalPaths };
}

export function withTerminalPaths(
  state: PipelineState,
  terminalPaths: PipelineNodePath[],
): PipelineState {
  return { ...state, terminalPaths };
}

export function withOutputNode(state: PipelineState): PipelineGraph {
  const graph = cloneGraph(state.graph);
  const outputPath = [OUTPUT_ID];
  if (graph.nodes.some((node) => pathEquals(node.path, outputPath))) {
    return graph;
  }
  graph.nodes.push(graphNode(OUTPUT_ID, outputPath, "output", "Output"));
  graph.edges.push(
    ...state.terminalPaths.map((source, index) => ({
      id: `edge_${state.nextEdgeIndex + index}`,
      source: [...source],
      target: outputPath,
    })),
  );
  return graph;
}

export function cloneGraph(graph: PipelineGraph): PipelineGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, path: [...node.path] })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: [...edge.source],
      target: [...edge.target],
    })),
  };
}

export function scopedNode(node: PipelineGraphNode, path: PipelineNodePath): PipelineGraphNode {
  return { ...node, path: [...path] };
}

function appendChildGraph(
  state: PipelineState,
  parentPath: PipelineNodePath,
  child: PipelineGraph,
): PipelineState {
  const childNodes = child.nodes
    .filter((node) => !isBoundaryPath(node.path))
    .map((node) => scopedNode(node, [...parentPath, ...node.path]));
  const childEdges: PipelineState["graph"]["edges"] = [];
  const terminalPaths: PipelineNodePath[] = [];
  let nextEdgeIndex = state.nextEdgeIndex;

  for (const edge of child.edges) {
    const sourceIsInput = isInputPath(edge.source);
    const targetIsOutput = isOutputPath(edge.target);
    const source = sourceIsInput ? [...parentPath] : [...parentPath, ...edge.source];
    if (targetIsOutput) {
      terminalPaths.push(source);
      continue;
    }
    const target = [...parentPath, ...edge.target];
    let childEdge: PipelineGraphEdge = {
      id: `edge_${nextEdgeIndex}`,
      source,
      target,
    };
    if (edge.label !== undefined) childEdge = { ...childEdge, label: edge.label };
    childEdges.push(childEdge);
    nextEdgeIndex += 1;
  }

  return {
    ...state,
    graph: {
      ...state.graph,
      nodes: [...state.graph.nodes, ...childNodes],
      edges: [...state.graph.edges, ...childEdges],
    },
    terminalPaths: terminalPaths.length === 0 ? [[...parentPath]] : terminalPaths,
    nextEdgeIndex,
  };
}

function appendNode(
  state: PipelineState,
  node: PipelineGraphNode,
  sourcePaths: PipelineNodePath[],
  terminalPaths: PipelineNodePath[],
  stageId?: string,
): PipelineState {
  const edges = sourcePaths.map((source, index) => ({
    id: `edge_${state.nextEdgeIndex + index}`,
    source: [...source],
    target: [...node.path],
  }));
  const stageIds = new Set(state.stageIds);
  if (stageId !== undefined) stageIds.add(stageId);
  return {
    graph: {
      ...state.graph,
      nodes: [...state.graph.nodes, node],
      edges: [...state.graph.edges, ...edges],
    },
    terminalPaths,
    stageIds,
    nextEdgeIndex: state.nextEdgeIndex + edges.length,
  };
}

function graphNode(
  id: string,
  path: PipelineNodePath,
  kind: PipelineStageKind,
  label: string,
  options: {
    description?: string | undefined;
    metadata?: JsonObject | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
    branchKey?: string | undefined;
  } = {},
): PipelineGraphNode {
  const node: PipelineGraphNode = { id, path: [...path], kind, label };
  if (options.description !== undefined) node.description = options.description;
  if (options.metadata !== undefined) node.metadata = options.metadata;
  if (options.agentId !== undefined) node.agentId = options.agentId;
  if (options.agentName !== undefined) node.agentName = options.agentName;
  if (options.pipelineId !== undefined) node.pipelineId = options.pipelineId;
  if (options.branchKey !== undefined) node.branchKey = options.branchKey;
  return node;
}

function validateStageId(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Pipeline stage id must be a string.");
  }
  const id = value.trim();
  if (id.length === 0) {
    throw new TypeError("Pipeline stage id must be a non-empty string.");
  }
  if (RESERVED_STAGE_IDS.has(id)) {
    throw new TypeError(`Pipeline stage id "${id}" is reserved.`);
  }
  return id;
}

function isBoundaryPath(path: PipelineNodePath): boolean {
  return isInputPath(path) || isOutputPath(path);
}

function isInputPath(path: PipelineNodePath): boolean {
  return path.length === 1 && path[0] === INPUT_ID;
}

function isOutputPath(path: PipelineNodePath): boolean {
  return path.length === 1 && path[0] === OUTPUT_ID;
}

function pathEquals(left: PipelineNodePath, right: PipelineNodePath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
