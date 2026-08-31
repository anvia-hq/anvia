import type { GraphExploreNode, GraphExploreResult } from "@anvia/graph";
import type { GraphExplorerController } from "@anvia/react/graph-explorer";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GraphExplorerNodePrimitive as GraphNode,
  GraphExplorerPrimitive as GraphExplorer,
  GraphExplorerProvider,
  graphExplorerNodeLabel,
} from "../src/graph-explorer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Graph explorer primitives", () => {
  it("requires a graph explorer provider", () => {
    expect(() => render(<GraphExplorer.Root />)).toThrow(
      "Graph explorer primitives must be used inside GraphExplorerProvider.",
    );
  });

  it("projects controller state and delegates user actions", () => {
    const controller = createController();
    render(
      <GraphExplorerProvider controller={controller}>
        <GraphExplorer.Root data-testid="explorer">
          <GraphExplorer.Search />
          <GraphExplorer.Viewport data-testid="viewport" />
          <GraphExplorer.Status />
          <GraphExplorer.Refresh />
          <GraphExplorer.Nodes>
            {(node) => (
              <GraphNode.Root data-testid={`node-${node.id}`}>
                <GraphNode.Trigger />
                <GraphNode.Expand options={{ direction: "both", maxDepth: 2 }} />
              </GraphNode.Root>
            )}
          </GraphExplorer.Nodes>
          <GraphExplorer.Empty />
        </GraphExplorer.Root>
      </GraphExplorerProvider>,
    );

    const explorer = screen.getByTestId("explorer");
    const person = screen.getByTestId("node-person_1");
    expect(explorer.getAttribute("data-state")).toBe("ready");
    expect(explorer.getAttribute("data-truncated")).toBe("true");
    expect(explorer.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByTestId("viewport").getAttribute("data-role")).toBe(
      "graph-explorer-viewport",
    );
    expect(screen.getByText("2 nodes, 1 relationships.")).toBeTruthy();
    expect(screen.getByRole("list").children).toHaveLength(2);
    expect(person.getAttribute("role")).toBe("listitem");
    expect(person.getAttribute("data-state")).toBe("selected");
    expect(person.getAttribute("data-match")).toBe("matched");
    expect(person.getAttribute("data-node-type")).toBe("Person");
    expect(screen.queryByText("No graph nodes.")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search graph" }), {
      target: { value: "ada" },
    });
    fireEvent.click(within(person).getByRole("button", { name: "Ada" }));
    fireEvent.click(within(person).getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh graph" }));

    expect(controller.setQuery).toHaveBeenCalledWith("ada");
    expect(controller.selectNode).toHaveBeenCalledWith("person_1");
    expect(controller.expandNode).toHaveBeenCalledWith("person_1", {
      direction: "both",
      maxDepth: 2,
    });
    expect(controller.refresh).toHaveBeenCalledOnce();
  });

  it("composes a loaded node directly into an application renderer", () => {
    const controller = createController({ selectedNodeId: undefined });
    render(
      <GraphExplorerProvider controller={controller}>
        <GraphNode.Root nodeId="product_1" asChild>
          <article data-testid="canvas-node">
            <GraphNode.Trigger>Open product</GraphNode.Trigger>
          </article>
        </GraphNode.Root>
      </GraphExplorerProvider>,
    );

    const node = screen.getByTestId("canvas-node");
    expect(node.tagName).toBe("ARTICLE");
    expect(node.getAttribute("role")).toBeNull();
    expect(node.getAttribute("data-node-id")).toBe("product_1");
    expect(node.getAttribute("data-match")).toBe("unmatched");
    fireEvent.click(screen.getByRole("button", { name: "Open product" }));
    expect(controller.selectNode).toHaveBeenCalledWith("product_1");
  });

  it("reports invalid node primitive composition", () => {
    const controller = createController();
    expect(() =>
      render(
        <GraphExplorerProvider controller={controller}>
          <GraphNode.Root />
        </GraphExplorerProvider>,
      ),
    ).toThrow(
      "GraphExplorerNodePrimitive.Root requires a nodeId outside GraphExplorerPrimitive.Nodes.",
    );
    expect(() =>
      render(
        <GraphExplorerProvider controller={controller}>
          <GraphNode.Root nodeId="missing" />
        </GraphExplorerProvider>,
      ),
    ).toThrow("Graph explorer node missing is not loaded.");
    expect(() =>
      render(
        <GraphExplorerProvider controller={controller}>
          <GraphNode.Trigger />
        </GraphExplorerProvider>,
      ),
    ).toThrow(
      "Graph explorer node primitives must be used inside GraphExplorerNodePrimitive.Root or GraphExplorerPrimitive.Nodes.",
    );
  });

  it("handles empty, loading, and error presentation states", () => {
    const empty = createController({
      nodes: [],
      nodeById: new Map(),
      relationships: [],
      matchedNodeIds: new Set(),
      status: "error",
      error: new Error("offline"),
      truncated: { nodes: false, relationships: false },
    });
    const { rerender } = render(
      <GraphExplorerProvider controller={empty}>
        <GraphExplorer.Root data-testid="empty-root">
          <GraphExplorer.Nodes keepMounted />
          <GraphExplorer.Empty>Nothing loaded.</GraphExplorer.Empty>
          <GraphExplorer.Status />
          <GraphExplorer.Refresh />
        </GraphExplorer.Root>
      </GraphExplorerProvider>,
    );

    expect(screen.getByRole("list").getAttribute("data-state")).toBe("empty");
    expect(screen.getByText("Nothing loaded.")).toBeTruthy();
    expect(screen.getByText("Graph exploration failed.")).toBeTruthy();

    const loading = createController({
      nodes: [],
      nodeById: new Map(),
      relationships: [],
      matchedNodeIds: new Set(),
      status: "loading",
      truncated: { nodes: false, relationships: false },
    });
    rerender(
      <GraphExplorerProvider controller={loading}>
        <GraphExplorer.Root data-testid="loading-root">
          <GraphExplorer.Empty />
          <GraphExplorer.Status />
          <GraphExplorer.Refresh />
        </GraphExplorer.Root>
      </GraphExplorerProvider>,
    );

    expect(screen.getByTestId("loading-root").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No graph nodes.")).toBeNull();
    expect(screen.getByText("Loading graph.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Refresh graph" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("labels nodes from display properties, keys, and opaque identities", () => {
    expect(graphExplorerNodeLabel({ ...nodes[0]!, properties: { title: "Countess" } })).toBe(
      "Countess",
    );
    expect(graphExplorerNodeLabel({ ...nodes[0]!, properties: { label: "Pioneer" } })).toBe(
      "Pioneer",
    );
    expect(
      graphExplorerNodeLabel({ ...nodes[0]!, key: "Person:Ada", properties: { name: " " } }),
    ).toBe("Person:Ada");
    expect(graphExplorerNodeLabel({ ...nodes[0]!, properties: {} })).toBe("Person person_1");
  });
});

const nodes: readonly GraphExploreNode[] = [
  {
    id: "person_1",
    type: "Person",
    identity: { name: "Ada" },
    properties: { name: "Ada", role: "Engineer" },
  },
  {
    id: "product_1",
    type: "Product",
    identity: { slug: "anvia" },
    properties: { name: "Anvia Graph" },
  },
];

function createController(
  overrides: Partial<GraphExplorerController> = {},
): GraphExplorerController {
  const result: GraphExploreResult = {
    nodes: [...nodes],
    relationships: [
      {
        id: "uses_1",
        type: "USES",
        from: "person_1",
        to: "product_1",
        properties: {},
      },
    ],
    truncated: { nodes: true, relationships: false },
  };
  const base: GraphExplorerController = {
    nodes: result.nodes,
    nodeById: new Map(result.nodes.map((node) => [node.id, node])),
    relationships: result.relationships,
    truncated: result.truncated,
    selectedNodeId: "person_1",
    selectedNode: result.nodes[0],
    query: "",
    matchedNodeIds: new Set(["person_1"]),
    status: "ready",
    error: undefined,
    explore: vi.fn(async () => undefined),
    expandNode: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    selectNode: vi.fn(),
    setQuery: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  };
  return { ...base, ...overrides };
}
