import { Usage } from "@anvia/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const extractMock = vi.hoisted(() => vi.fn());
vi.mock("@anvia/core/extractor", () => ({ extract: extractMock }));

import {
  defineGraphSchema,
  extractGraphFacts,
  GraphFactConflictError,
  ingestGraphText,
  prepareGraphDocuments,
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

  it("prepares and writes text with reusable vector documents", async () => {
    extractMock.mockResolvedValue({
      output: {
        entities: [{ ref: "p", type: "Product", properties: { id: "one", name: "One" } }],
        relationships: [],
      },
      usage: Usage.empty(),
    });
    const embeddedTexts: string[] = [];
    const embeddingModel = {
      provider: "test",
      modelId: "test",
      async embedTexts(texts: string[]) {
        embeddedTexts.push(...texts);
        return texts.map((document) => ({ document, vector: [document.length] }));
      },
    };
    const replaceDocuments = vi.fn(async () => ({
      documents: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      chunks: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
      entities: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      mentions: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
    }));
    const graph = { schema, replaceDocuments };

    const result = await ingestGraphText({
      graph,
      document: { id: "incident", text: "Product One", metadata: { tenant: "acme" } },
      extractionModel: {} as never,
      embeddingModel,
      chunking: { strategy: "fixed", maxSize: 8 },
      conflict: "keep-existing",
      orphanEntities: "keep",
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.vectorDocuments).toMatchObject([
      {
        id: "incident",
        metadata: { tenant: "acme" },
        embeddings: [{ vector: [8] }, { vector: [3] }],
      },
    ]);
    expect(embeddedTexts).toContain("Product\nid: one\nname: One");
    expect(replaceDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: "keep-existing", orphanEntities: "keep" }),
    );
  });

  it("lets advanced callers prepare graph data without writing", async () => {
    extractMock.mockResolvedValue({
      output: { entities: [], relationships: [] },
      usage: Usage.empty(),
    });
    const embeddingModel = {
      provider: "test",
      modelId: "test",
      async embedTexts(texts: string[]) {
        return texts.map((document) => ({ document, vector: [1] }));
      },
    };
    const prepared = await prepareGraphDocuments({
      graph: { schema },
      documents: [{ id: "one", text: "Product One" }],
      extractionModel: {} as never,
      embeddingModel,
    });

    expect(prepared.documents).toEqual([{ id: "one" }]);
    expect(prepared.vectorDocuments[0]?.id).toBe("one");

    await expect(
      prepareGraphDocuments({
        graph: { schema },
        documents: [{ id: "invalid", text: "Product One", metadata: { tags: ["one"] } } as never],
        extractionModel: {} as never,
        embeddingModel,
      }),
    ).rejects.toThrow("portable primitive value");
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
