import { Handle, MarkerType, type Node, type NodeProps, Position } from "@xyflow/react";
import type { GraphExploreNode, GraphExploreRelationship, GraphExploreResult } from "@anvia/graph";

export type ExplorerNodeData = {
  label: string;
  type: string;
  color: string;
};

export type ExplorerFlowNode = Node<ExplorerNodeData, "graphEntity">;

export const explorerNodeTypes = {
  graphEntity: GraphEntityNode,
};

export function toExplorerFlow(result: GraphExploreResult, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNodes = result.nodes.filter((node) => graphNodeMatches(node, normalizedQuery));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodes = positionNodes(visibleNodes);
  const edges = result.relationships
    .filter((relationship) => visibleIds.has(relationship.from) && visibleIds.has(relationship.to))
    .map((relationship) => relationshipEdge(relationship));
  return { nodes, edges };
}

export function graphNodeLabel(node: GraphExploreNode): string {
  for (const key of ["name", "title", "label"] as const) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  if (node.key !== undefined) return node.key;
  return `${node.type} ${node.id}`;
}

function GraphEntityNode(props: NodeProps<ExplorerFlowNode>) {
  return (
    <article
      className={[
        "relative w-[180px] rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition",
        props.selected ? "border-foreground shadow-md" : "border-border/80",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-1.5 !border-0 !bg-muted-foreground/50"
      />
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={["size-2.5 shrink-0 rounded-full", props.data.color].join(" ")} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{props.data.label}</div>
          <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {props.data.type}
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-0 !bg-muted-foreground/50"
      />
    </article>
  );
}

function positionNodes(nodes: readonly GraphExploreNode[]): ExplorerFlowNode[] {
  return nodes.map((node, index) => {
    const angle = index * 2.399963;
    const radius = 180 * Math.sqrt(index);
    return {
      id: node.id,
      type: "graphEntity",
      position: {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      },
      data: {
        label: graphNodeLabel(node),
        type: node.type,
        color: nodeTypeColor(node.type),
      },
    };
  });
}

function relationshipEdge(relationship: GraphExploreRelationship) {
  return {
    id: relationship.id,
    source: relationship.from,
    target: relationship.to,
    label: relationship.type,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    labelStyle: { fontSize: 10, fontWeight: 600 },
    style: { strokeWidth: 1.5 },
  };
}

function graphNodeMatches(node: GraphExploreNode, query: string): boolean {
  if (query.length === 0) return true;
  const searchable = [node.type, node.key, ...Object.values(node.identity), ...propertyText(node)];
  return searchable.some((value) =>
    String(value ?? "")
      .toLocaleLowerCase()
      .includes(query),
  );
}

function propertyText(node: GraphExploreNode): string[] {
  const text: string[] = [];
  for (const [key, value] of Object.entries(node.properties)) {
    text.push(key, Array.isArray(value) ? value.join(" ") : String(value));
  }
  return text;
}

function nodeTypeColor(type: string): string {
  const colors = [
    "bg-emerald-500",
    "bg-sky-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-fuchsia-500",
  ];
  let hash = 0;
  for (const character of type) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length] ?? "bg-muted-foreground";
}
