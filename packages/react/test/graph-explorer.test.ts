// @vitest-environment happy-dom
import type { GraphExploreOptions, GraphExploreResult, GraphSchemaLike } from "@anvia/graph";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as publicGraphExplorer from "../src/graph-explorer";
import { type GraphExplorerExpandNodeOptions, useGraphExplorer } from "../src/graph-explorer";

describe("useGraphExplorer", () => {
  it("replaces overviews, merges expansions, and indexes selection and search", async () => {
    const load = vi.fn(async (request: GraphExploreOptions<GraphSchemaLike>) =>
      request.mode === "overview" ? overviewResult : expansionResult,
    );
    const { result } = renderHook(() => useGraphExplorer({ explore: load }));

    await act(async () => {
      await result.current.explore({
        mode: "overview",
        nodeTypes: ["Person", "Product"],
        relationships: ["USES"],
        includeProvenance: true,
        maxNodes: 40,
        maxRelationships: 80,
      });
    });
    act(() => {
      result.current.selectNode("person_1");
      result.current.setQuery("graph");
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.selectedNode?.id).toBe("person_1");
    expect(result.current.nodeById.get("product_1")?.type).toBe("Product");
    expect([...result.current.matchedNodeIds]).toEqual(["product_1"]);

    await act(async () => {
      await result.current.expandNode("person_1", { direction: "both", maxDepth: 1 });
    });

    expect(load.mock.calls[1]?.[0]).toMatchObject({
      mode: "expand",
      nodeIds: ["person_1"],
      nodeTypes: ["Person", "Product"],
      relationships: ["USES"],
      includeProvenance: true,
      maxNodes: 40,
      maxRelationships: 80,
      direction: "both",
      maxDepth: 1,
    });
    expect(result.current.nodes.map((node) => node.id)).toEqual([
      "person_1",
      "product_1",
      "database_1",
    ]);
    expect(result.current.nodeById.get("person_1")?.properties.name).toBe("Ada Updated");
    expect(result.current.relationships).toHaveLength(2);
    expect(result.current.truncated.nodes).toBe(true);
    expect(() => result.current.expandNode("")).toThrow(
      "Graph explorer node id must be non-empty.",
    );
  });

  it("retries the latest overview while expanding with the last successful filters", async () => {
    const offline = new Error("offline");
    const load = vi
      .fn<(options: GraphExploreOptions<GraphSchemaLike>) => Promise<GraphExploreResult>>()
      .mockResolvedValueOnce(overviewResult)
      .mockRejectedValueOnce(offline)
      .mockResolvedValueOnce(expansionResult);
    const { result } = renderHook(() => useGraphExplorer({ explore: load }));

    await act(async () => {
      await result.current.explore({ mode: "overview", nodeTypes: ["Person"] });
    });
    let caught: unknown;
    await act(async () => {
      caught = await result.current
        .explore({ mode: "overview", nodeTypes: ["Product"] })
        .catch((error: unknown) => error);
    });

    expect(caught).toBe(offline);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(offline);
    expect(result.current.nodes).toEqual(overviewResult.nodes);

    await act(async () => {
      await result.current.expandNode("person_1");
    });
    expect(load.mock.calls[2]?.[0]).toMatchObject({
      mode: "expand",
      nodeIds: ["person_1"],
      nodeTypes: ["Person"],
    });

    act(() => result.current.stop());
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeUndefined();
  });

  it("refreshes with a fresh signal and ignores superseded results", async () => {
    const first = deferred<GraphExploreResult>();
    const second = deferred<GraphExploreResult>();
    const load = vi
      .fn<(options: GraphExploreOptions<GraphSchemaLike>) => Promise<GraphExploreResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useGraphExplorer({ explore: load }));
    let firstRun!: Promise<GraphExploreResult | undefined>;
    let secondRun!: Promise<GraphExploreResult | undefined>;

    act(() => {
      firstRun = result.current.explore({ mode: "overview", nodeTypes: ["Person"] });
    });
    act(() => {
      secondRun = result.current.refresh();
    });

    expect(load.mock.calls[0]?.[0].abortSignal?.aborted).toBe(true);
    expect(load.mock.calls[0]?.[0].abortSignal).not.toBe(load.mock.calls[1]?.[0].abortSignal);
    await act(async () => {
      first.resolve(overviewResult);
      await firstRun;
    });
    expect(result.current.nodes).toEqual([]);
    await act(async () => {
      second.resolve(otherOverviewResult);
      await secondRun;
    });
    expect(result.current.nodes).toEqual(otherOverviewResult.nodes);
  });

  it("returns to ready immediately when an external signal aborts", async () => {
    const pending = deferred<GraphExploreResult>();
    const load = vi.fn((_request: GraphExploreOptions<GraphSchemaLike>) => pending.promise);
    const { result } = renderHook(() => useGraphExplorer({ explore: load }));
    const external = new AbortController();
    let run!: Promise<GraphExploreResult | undefined>;

    act(() => {
      run = result.current.explore({ mode: "overview", abortSignal: external.signal });
    });
    expect(result.current.status).toBe("loading");
    act(() => external.abort());
    expect(result.current.status).toBe("ready");

    await act(async () => {
      pending.resolve(overviewResult);
      await run;
    });
    expect(result.current.nodes).toEqual([]);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    let abortedResult: GraphExploreResult | undefined;
    await act(async () => {
      abortedResult = await result.current.explore({
        mode: "overview",
        abortSignal: alreadyAborted.signal,
      });
    });
    expect(abortedResult).toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
  });

  it("supports initial state, custom search, reset, and the public subpath", () => {
    const load = vi.fn(async () => overviewResult);
    const { result } = renderHook(() =>
      useGraphExplorer({
        explore: load,
        initialResult: overviewResult,
        initialQuery: "engineer",
        searchText: (node) => String(node.properties.role ?? ""),
      }),
    );

    expect(result.current.status).toBe("ready");
    expect([...result.current.matchedNodeIds]).toEqual(["person_1"]);
    expect(publicGraphExplorer.useGraphExplorer).toBe(useGraphExplorer);

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.query).toBe("");
    expect(result.current.nodes).toEqual([]);
  });

  it("preserves schema-specific exploration options", () => {
    type Schema = GraphSchemaLike<{
      nodes: { Person: never };
      relationships: { KNOWS: never };
    }>;
    const load = vi.fn(async (_options: GraphExploreOptions<Schema>) => overviewResult);
    const { result } = renderHook(() => useGraphExplorer<Schema>({ explore: load }));

    expectTypeOf(result.current.explore).parameter(0).toEqualTypeOf<GraphExploreOptions<Schema>>();
    expectTypeOf<Parameters<typeof result.current.expandNode>[1]>().toEqualTypeOf<
      GraphExplorerExpandNodeOptions<Schema> | undefined
    >();
  });
});

const overviewResult: GraphExploreResult = {
  nodes: [
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
  ],
  relationships: [
    {
      id: "uses_1",
      type: "USES",
      from: "person_1",
      to: "product_1",
      properties: {},
    },
  ],
  truncated: { nodes: false, relationships: false },
};

const expansionResult: GraphExploreResult = {
  nodes: [
    {
      ...overviewResult.nodes[0]!,
      properties: { name: "Ada Updated", role: "Engineer" },
    },
    {
      id: "database_1",
      type: "Database",
      identity: { name: "Graph Database" },
      properties: { name: "Graph Database" },
    },
  ],
  relationships: [
    {
      id: "knows_1",
      type: "KNOWS",
      from: "person_1",
      to: "database_1",
      properties: {},
    },
  ],
  truncated: { nodes: true, relationships: false },
};

const otherOverviewResult: GraphExploreResult = {
  nodes: [
    {
      id: "person_2",
      type: "Person",
      identity: { name: "Grace" },
      properties: { name: "Grace" },
    },
  ],
  relationships: [],
  truncated: { nodes: false, relationships: false },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
