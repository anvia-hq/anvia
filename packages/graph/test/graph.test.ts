import { Usage } from "@anvia/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const extractMock = vi.hoisted(() => vi.fn());
vi.mock("@anvia/core/extractor", () => ({ extract: extractMock }));

import {
  createGraphContext,
  createGraphSearchTool,
  createKnowledgeGraph,
  defineGraphSchema,
  extractGraphFacts,
  formatGraphContext,
  ingestGraphText,
  ingestGraphTextToStores,
  prepareGraphDocuments,
  resolveGraphExploreOptions,
  resolveGraphRetrieveOptions,
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
            identity: ["missing"] as never,
            properties: z.strictObject({ id: z.string() }),
          },
        },
        relationships: {},
      }),
    ).toThrow("not declared");
  });

  it("auto-strictens plain z.object schemas and allows omitting relationships or empty relationship properties", () => {
    const simple = defineGraphSchema({
      nodes: {
        Product: {
          description: "A product.",
          identity: ["id"],
          properties: z.object({ id: z.string(), name: z.string() }),
        },
      },
    });
    expect(simple.relationships).toEqual({});
    expect(() =>
      simple.nodes.Product.properties.parse({ id: "1", name: "a", extra: true }),
    ).toThrow();

    const withEdge = defineGraphSchema({
      nodes: {
        Product: {
          description: "A product.",
          identity: ["id"],
          properties: z.object({ id: z.string() }),
        },
      },
      relationships: {
        DEPENDS_ON: {
          description: "Product dependency.",
          from: "Product",
          to: "Product",
        },
      },
    });
    expect(withEdge.relationships.DEPENDS_ON.properties.parse({})).toEqual({});
    expect(() =>
      defineGraphSchema({
        nodes: {
          Product: {
            description: "A product.",
            identity: ["id"],
            properties: z.looseObject({ id: z.string() }),
          },
        },
      }),
    ).toThrow("strict Zod object schema");
  });

  it("supports warn mode for invalid extracted facts and reports extraction progress", async () => {
    const relSchema = defineGraphSchema({
      nodes: {
        Product: {
          description: "A product.",
          identity: ["id"],
          properties: z.object({ id: z.string() }),
        },
      },
      relationships: {
        DEPENDS_ON: {
          description: "Dependency.",
          from: "Product",
          to: "Product",
        },
      },
    });
    extractMock.mockResolvedValue({
      output: {
        entities: [{ ref: "p", type: "Product", properties: { id: "one" } }],
        relationships: [{ type: "DEPENDS_ON", from: "p", to: "missing-ref", properties: {} }],
      },
      usage: Usage.empty(),
    });
    const events: unknown[] = [];
    const result = await extractGraphFacts({
      model: {} as never,
      schema: relSchema,
      chunks: [{ id: "chunk-1", documentId: "doc", index: 0, text: "Product one" }],
      onInvalidFact: "warn",
      onProgress: (event) => events.push(event),
    });

    expect(result.output.entities).toHaveLength(1);
    expect(result.output.relationships).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "GRAPH_FACT_INVALID_SKIPPED",
        kind: "relationship",
        chunkId: "chunk-1",
        type: "DEPENDS_ON",
      }),
    ]);
    expect(events).toEqual([{ stage: "extract", completed: 1, total: 1, chunkId: "chunk-1" }]);
  });

  it("defaults ingestion policies, retrieval options, search tool, graph context, and facade", async () => {
    extractMock.mockResolvedValue({
      output: {
        entities: [{ ref: "p", type: "Product", properties: { id: "one", name: "One" } }],
        relationships: [],
      },
      usage: Usage.empty(),
    });
    const embeddingModel = {
      provider: "test",
      modelId: "test",
      async embedTexts(texts: string[]) {
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    const sampleContext = {
      seeds: [
        {
          key: 'Product:{"id":"one"}',
          type: "Product",
          score: 0.9,
          properties: { id: "one", name: "One" },
          sourceChunkIds: ["doc:chunk:0"],
        },
      ],
      nodes: [
        {
          key: 'Product:{"id":"one"}',
          type: "Product",
          identity: { id: "one" },
          properties: { id: "one", name: "One" },
          sourceChunkIds: ["doc:chunk:0"],
        },
      ],
      relationships: [],
      evidence: [
        {
          chunkId: "doc:chunk:0",
          documentId: "doc",
          index: 0,
          text: "Product One",
          metadata: {},
        },
      ],
    };
    const replaceDocuments = vi.fn(async () => ({
      documents: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      chunks: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      entities: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      mentions: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
    }));
    const retrieve = vi.fn(async () => sampleContext);
    const graph = {
      schema,
      evidenceCapability: "chunks" as const,
      replaceDocuments,
      retrieve,
    };

    const resolved = resolveGraphRetrieveOptions({
      schema,
      evidenceCapability: "chunks",
      availableSeeds: ["chunks", "entities"],
    });
    expect(resolved).toEqual({
      search: { type: "vector", seeds: ["entities"], topK: 8 },
      traversal: {
        relationships: [],
        direction: "both",
        maxDepth: 2,
        maxNodes: 40,
        maxRelationships: 80,
      },
      evidence: { type: "chunks", maxChunks: 12 },
    });

    const kg = createKnowledgeGraph({
      graph,
      embeddingModel,
      extractionModel: {} as never,
    });
    await kg.ingest("Product One");
    expect(replaceDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ conflict: "overwrite", orphanEntities: "delete" }),
    );

    const textTool = createGraphSearchTool({
      name: "search_graph",
      graph,
      model: embeddingModel,
      format: formatGraphContext,
    });
    const formatted = await textTool.call({ query: "One", topK: 3 });
    expect(formatted).toContain("[Product]");
    expect(formatted).toContain("Product One");
    expect(retrieve).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "One", search: { topK: 3 } }),
    );

    await textTool.call({ query: "One", topK: 500 });
    expect(retrieve).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "One", search: { topK: 8 } }),
    );

    const boundedTool = createGraphSearchTool({
      name: "bounded_graph",
      graph,
      model: embeddingModel,
      search: { topK: 4 },
    });
    await boundedTool.call({ query: "One", topK: 50 });
    expect(retrieve).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "One", search: { topK: 4 } }),
    );
    expect(() =>
      createGraphSearchTool({
        name: "invalid_graph",
        graph,
        model: embeddingModel,
        search: { topK: 0 },
      }),
    ).toThrow(RangeError);

    const ctx = createGraphContext({ graph, model: embeddingModel });
    const docs = await ctx.retrieve({ query: "One" });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.text).toContain("Entities:");

    const kgTool = kg.asTool({ name: "kg_search" });
    expect(await kgTool.call({ query: "One" })).toEqual(sampleContext);
    expect(await kg.asContext().retrieve({ query: "One" })).toHaveLength(1);
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
    ).rejects.toMatchObject({
      name: "GraphFactConflictError",
      code: "GRAPH_FACT_CONFLICT",
      kind: "entity",
      factKey: 'Product:{"id":"one"}',
      type: "Product",
      identity: { id: "one" },
      property: "name",
      sourceChunkIds: ["one", "two"],
      candidates: [
        { chunkId: "one", value: "One" },
        { chunkId: "two", value: "Changed" },
      ],
    });
  });

  it("resolves property-level fact conflicts and returns structured warnings", async () => {
    const conflictSchema = defineGraphSchema({
      nodes: {
        Product: {
          description: "A product.",
          identity: ["id"],
          properties: z.strictObject({
            id: z.string(),
            summary: z.string(),
            aliases: z.array(z.string()),
            confidence: z.number(),
          }),
        },
      },
      relationships: {
        REFERENCES: {
          description: "A product references itself.",
          from: "Product",
          to: "Product",
          properties: z.strictObject({ note: z.string() }),
        },
      },
    });
    extractMock
      .mockResolvedValueOnce({
        output: {
          entities: [
            {
              ref: "sqlite",
              type: "Product",
              properties: {
                id: "sqlite",
                summary: "Database",
                aliases: ["sqlite"],
                confidence: 0.6,
              },
            },
          ],
          relationships: [
            { type: "REFERENCES", from: "sqlite", to: "sqlite", properties: { note: "first" } },
          ],
        },
        usage: Usage.empty(),
      })
      .mockResolvedValueOnce({
        output: {
          entities: [
            {
              ref: "sqlite",
              type: "Product",
              properties: {
                id: "sqlite",
                summary: "Embedded SQL database",
                aliases: ["SQLite", "sqlite"],
                confidence: 0.9,
              },
            },
          ],
          relationships: [
            { type: "REFERENCES", from: "sqlite", to: "sqlite", properties: { note: "second" } },
          ],
        },
        usage: Usage.empty(),
      });

    const result = await extractGraphFacts({
      model: {} as never,
      schema: conflictSchema,
      chunks: [
        { id: "one", documentId: "doc", index: 0, text: "one" },
        { id: "two", documentId: "doc", index: 1, text: "two" },
      ],
      conflicts: {
        entity: {
          properties: {
            summary: "prefer-longest",
            aliases: "union",
            confidence: "max",
          },
        },
        relationship: {
          resolve: (conflict) => conflict.candidates.at(-1)?.value,
        },
      },
    });

    expect(result.output.entities[0]).toMatchObject({
      properties: {
        id: "sqlite",
        summary: "Embedded SQL database",
        aliases: ["sqlite", "SQLite"],
        confidence: 0.9,
      },
      sourceChunkIds: ["one", "two"],
    });
    expect(result.output.relationships[0]).toMatchObject({
      properties: { note: "second" },
      sourceChunkIds: ["one", "two"],
    });
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GRAPH_FACT_CONFLICT_RESOLVED",
          kind: "entity",
          property: "summary",
          strategy: "prefer-longest",
          resolvedValue: "Embedded SQL database",
        }),
        expect.objectContaining({
          code: "GRAPH_FACT_CONFLICT_RESOLVED",
          kind: "relationship",
          property: "note",
          strategy: "custom",
          resolvedValue: "second",
        }),
      ]),
    );
  });

  it("truncates entity embedding text to maxEntityTextLength", async () => {
    extractMock.mockResolvedValue({
      output: {
        entities: [
          {
            ref: "p",
            type: "Product",
            properties: { id: "one", name: "A very long product name" },
          },
        ],
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

    await prepareGraphDocuments({
      graph: { schema },
      documents: [{ id: "incident", text: "Product One" }],
      extractionModel: {} as never,
      embeddingModel,
      maxEntityTextLength: 12,
    });

    expect(embeddedTexts).toContain("Product\nid: ");
    expect(embeddedTexts).toContain("Product One");
  });

  it("rejects a non-positive maxEntityTextLength", async () => {
    await expect(
      prepareGraphDocuments({
        graph: { schema },
        documents: [{ id: "incident", text: "Product One" }],
        extractionModel: {} as never,
        embeddingModel: {} as never,
        maxEntityTextLength: 0,
      }),
    ).rejects.toThrow(RangeError);
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
    expect(result.receipt).toMatchObject({
      documentIds: ["incident"],
      entityKeys: ['Product:{"id":"one"}'],
      vectorDocumentIds: ["incident"],
      graphWrite: { status: "completed" },
      vectorWrite: { status: "not-requested" },
    });
  });

  it("reports vector-stage partial failures with a reconciliation receipt", async () => {
    extractMock.mockResolvedValue({
      output: { entities: [], relationships: [] },
      usage: Usage.empty(),
    });
    const graph = {
      schema,
      replaceDocuments: vi.fn(async () => ({
        documents: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        chunks: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        entities: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
        relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
        mentions: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      })),
    };
    const vectorStore = { upsert: vi.fn(async () => Promise.reject(new Error("qdrant down"))) };

    await expect(
      ingestGraphTextToStores({
        graph,
        vectorStore,
        document: { id: "article-1", text: "Product One" },
        revision: "rev-2",
        extractionModel: {} as never,
        embeddingModel: {
          provider: "test",
          modelId: "test",
          async embedTexts(texts: string[]) {
            return texts.map((document) => ({ document, vector: [1] }));
          },
        },
        conflict: "overwrite",
        orphanEntities: "delete",
      }),
    ).rejects.toMatchObject({
      code: "GRAPH_INGESTION_STAGE_FAILED",
      stage: "vector",
      receipt: {
        documentIds: ["article-1"],
        revision: "rev-2",
        graphWrite: { status: "completed" },
        vectorWrite: { status: "failed" },
      },
    });
    expect(graph.replaceDocuments).toHaveBeenCalledOnce();
    expect(vectorStore.upsert).toHaveBeenCalledOnce();
  });

  it("returns a completed receipt after writing graph and vector stores", async () => {
    extractMock.mockResolvedValue({
      output: { entities: [], relationships: [] },
      usage: Usage.empty(),
    });
    const graph = {
      schema,
      replaceDocuments: vi.fn(async () => ({
        documents: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        chunks: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        entities: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
        relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
        mentions: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      })),
    };
    const vectorStore = { upsert: vi.fn(async () => undefined) };

    const result = await ingestGraphTextToStores({
      graph,
      vectorStore,
      vectorProviderOptions: { wait: true },
      document: { id: "article-1", text: "Product One" },
      revision: "rev-3",
      extractionModel: {} as never,
      embeddingModel: {
        provider: "test",
        modelId: "test",
        async embedTexts(texts: string[]) {
          return texts.map((document) => ({ document, vector: [1] }));
        },
      },
      conflict: "overwrite",
      orphanEntities: "delete",
    });

    expect(vectorStore.upsert).toHaveBeenCalledWith({
      documents: result.vectorDocuments,
      providerOptions: { wait: true },
    });
    expect(result.receipt).toMatchObject({
      documentIds: ["article-1"],
      revision: "rev-3",
      graphWrite: { status: "completed" },
      vectorWrite: { status: "completed" },
    });
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
      includeProvenance: false,
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
