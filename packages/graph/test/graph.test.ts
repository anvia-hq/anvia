import { Usage } from "@anvia/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const extractMock = vi.hoisted(() => vi.fn());
vi.mock("@anvia/core/extractor", () => ({ extract: extractMock }));

import {
  defineGraphSchema,
  extractGraphFacts,
  GraphFactConflictError,
  resolveGraphExploreOptions,
} from "../src/index.js";

describe("provider-neutral graph primitives", () => {
  beforeEach(() => extractMock.mockReset());

  const schema = defineGraphSchema({
    nodes: {
      Product: {
        description: "A product.",
        identity: ["id"],
        properties: z.strictObject({ id: z.string(), name: z.string() }),
      },
    },
    relationships: {},
  });

  it("freezes a strict provider-neutral schema", () => {
    expect(schema.kind).toBe("graph-schema");
    expect(Object.isFrozen(schema.nodes.Product?.identity)).toBe(true);
    expect(() =>
      defineGraphSchema({
        nodes: {
          Product: {
            description: "A product.",
            identity: ["missing"],
            properties: z.strictObject({ id: z.string() }),
          },
        },
        relationships: {},
      }),
    ).toThrow("not declared");
  });

  it("extracts deterministic facts independently of a database provider", async () => {
    extractMock.mockResolvedValue({
      output: {
        entities: [{ ref: "p", type: "Product", properties: { id: "one", name: "One" } }],
        relationships: [],
      },
      usage: Usage.empty(),
    });
    const result = await extractGraphFacts({
      model: {} as never,
      schema,
      chunks: [{ id: "chunk", documentId: "doc", index: 0, text: "Product One" }],
    });
    expect(result.output.entities[0]).toMatchObject({
      key: 'Product:{"id":"one"}',
      sourceChunkIds: ["chunk"],
    });
    expect(result.output.mentions).toEqual([
      { chunkId: "chunk", entityKey: 'Product:{"id":"one"}' },
    ]);
  });

  it("reports conflicts across chunks with the shared error type", async () => {
    extractMock
      .mockResolvedValueOnce({
        output: {
          entities: [{ ref: "p", type: "Product", properties: { id: "one", name: "One" } }],
          relationships: [],
        },
        usage: Usage.empty(),
      })
      .mockResolvedValueOnce({
        output: {
          entities: [{ ref: "p", type: "Product", properties: { id: "one", name: "Changed" } }],
          relationships: [],
        },
        usage: Usage.empty(),
      });
    await expect(
      extractGraphFacts({
        model: {} as never,
        schema,
        chunks: [
          { id: "one", documentId: "doc", index: 0, text: "one" },
          { id: "two", documentId: "doc", index: 1, text: "two" },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphFactConflictError);
  });

  it("resolves bounded graph exploration options", () => {
    expect(resolveGraphExploreOptions(schema, { mode: "overview" })).toEqual({
      mode: "overview",
      nodeTypes: ["Product"],
      relationships: [],
      maxNodes: 100,
      maxRelationships: 200,
    });
    expect(() =>
      resolveGraphExploreOptions(schema, {
        mode: "expand",
        nodeIds: ["one"],
        maxDepth: 5,
      }),
    ).toThrow("between 1 and 4");
  });
});
