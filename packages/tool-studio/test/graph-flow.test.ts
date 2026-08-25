import type { GraphExploreResult } from "@anvia/graph";
import { describe, expect, it } from "vitest";
import { graphNodeLabel, toExplorerFlow } from "../src/ui/app/modules/graphs/graph-flow";

const graph: GraphExploreResult = {
  nodes: [
    {
      id: "one",
      key: "person:ada",
      type: "Person",
      identity: { email: "ada@example.com" },
      properties: { name: "Ada", role: "Engineer" },
    },
    {
      id: "two",
      type: "Company",
      identity: { slug: "anvia" },
      properties: { title: "Anvia" },
    },
  ],
  relationships: [{ id: "works", type: "WORKS_AT", from: "one", to: "two", properties: {} }],
  truncated: { nodes: false, relationships: false },
};

describe("graph explorer flow", () => {
  it("creates deterministic nodes, relationship arrows, and useful labels", () => {
    const flow = toExplorerFlow(graph, "");
    expect(flow.nodes.map((node) => node.id)).toEqual(["one", "two"]);
    expect(flow.edges).toEqual([
      expect.objectContaining({ id: "works", source: "one", target: "two", label: "WORKS_AT" }),
    ]);
    expect(graphNodeLabel(graph.nodes[0]!)).toBe("Ada");
  });

  it("searches properties and removes relationships with hidden endpoints", () => {
    const flow = toExplorerFlow(graph, "engineer");
    expect(flow.nodes.map((node) => node.id)).toEqual(["one"]);
    expect(flow.edges).toEqual([]);
  });
});
