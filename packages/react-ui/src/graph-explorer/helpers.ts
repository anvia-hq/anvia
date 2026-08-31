import type { GraphExploreNode } from "@anvia/graph";

export function graphExplorerNodeLabel(node: GraphExploreNode): string {
  for (const key of ["name", "title", "label"] as const) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  if (node.key !== undefined) return node.key;
  return `${node.type} ${node.id}`;
}
