import type { GraphExploreResult } from "@anvia/graph";
import { describe, expect, it } from "vitest";
import { toExplorerFlow } from "../src/ui/app/modules/graphs/graph-flow";

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
    const flow = toExplorerFlow(graph, new Set(["one", "two"]));
    expect(flow.nodes.map((node) => node.id)).toEqual(["one", "two"]);
    expect(flow.nodes[0]?.data.label).toBe("Ada");
    expect(flow.edges).toEqual([
      expect.objectContaining({ id: "works", source: "one", target: "two", label: "WORKS_AT" }),
    ]);
  });

  it("removes relationships with hidden endpoints", () => {
    const flow = toExplorerFlow(graph, new Set(["one"]));
    expect(flow.nodes.map((node) => node.id)).toEqual(["one"]);
    expect(flow.edges).toEqual([]);
  });
});
