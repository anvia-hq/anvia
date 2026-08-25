import type { GraphExploreResult } from "@anvia/graph";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerGraphRoutes } from "../src/runtime/graphs";

const schema = {
  kind: "graph-schema",
  nodes: {
    Person: {
      description: "A person.",
      identity: ["name"],
      properties: z.strictObject({ name: z.string() }),
    },
  },
  relationships: {
    KNOWS: {
      description: "One person knows another.",
      from: "Person",
      to: "Person",
      properties: z.strictObject({}),
    },
  },
} as const;

const result: GraphExploreResult = {
  nodes: [{ id: "1", type: "Person", identity: { name: "Ada" }, properties: { name: "Ada" } }],
  relationships: [],
  truncated: { nodes: false, relationships: false },
};

describe("Studio graph explorer routes", () => {
  it("lists registered schemas and forwards validated bounded requests", async () => {
    const explore = vi.fn().mockResolvedValue(result);
    const app = new Hono();
    registerGraphRoutes(app, [{ id: "knowledge", name: "Knowledge", graph: { schema, explore } }]);

    const list = await app.request("http://studio.test/graphs");
    expect(await list.json()).toEqual({
      graphs: [
        {
          id: "knowledge",
          name: "Knowledge",
          nodeTypes: [{ name: "Person", description: "A person." }],
          relationshipTypes: [
            {
              name: "KNOWS",
              description: "One person knows another.",
              from: "Person",
              to: "Person",
            },
          ],
        },
      ],
    });

    const response = await app.request("http://studio.test/graphs/knowledge/explore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "expand", nodeIds: ["1"], maxDepth: 2 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(explore).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "expand",
        nodeIds: ["1"],
        nodeTypes: ["Person"],
        relationships: ["KNOWS"],
        direction: "both",
        maxDepth: 2,
        maxNodes: 100,
        maxRelationships: 200,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects unknown graphs and requests beyond the shared limits", async () => {
    const app = new Hono();
    registerGraphRoutes(app, [{ id: "knowledge", graph: { schema, explore: vi.fn() } }]);

    expect(
      (await app.request("http://studio.test/graphs/missing/explore", { method: "POST" })).status,
    ).toBe(404);
    const invalid = await app.request("http://studio.test/graphs/knowledge/explore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "overview", maxNodes: 501 }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("rejects duplicate graph identifiers", () => {
    const app = new Hono();
    const graph = { schema, explore: vi.fn() };
    expect(() =>
      registerGraphRoutes(app, [
        { id: "duplicate", graph },
        { id: "duplicate", graph },
      ]),
    ).toThrow("Duplicate Studio graph id");
  });
});
