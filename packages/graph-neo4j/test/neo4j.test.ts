import { Usage } from "@anvia/core";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import { createGraphSearchTool } from "@anvia/graph";
import type { Driver, ManagedTransaction } from "neo4j-driver";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const extractMock = vi.hoisted(() => vi.fn());

vi.mock("@anvia/core/extractor", () => ({ extract: extractMock }));

import {
  defineNeo4jGraphSchema,
  extractGraphFacts,
  GraphFactConflictError,
  ManagedNeo4jKnowledgeGraph,
  Neo4jClient,
  Neo4jKnowledgeGraph,
  retrieveGraphContext,
} from "../src/index.js";

const schema = defineNeo4jGraphSchema({
  nodes: {
    Product: {
      description: "A product.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
    Incident: {
      description: "An incident.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), title: z.string() }),
    },
  },
  relationships: {
    AFFECTS: {
      description: "An incident affects a product.",
      from: "Incident",
      to: "Product",
      properties: z.strictObject({ severity: z.enum(["low", "high"]) }),
    },
  },
});

type FakeRecord = { get(key: string): unknown };

function record(value: Record<string, unknown>): FakeRecord {
  return { get: (key) => value[key] };
}

function fakeDriver(
  options: {
    executeQuery?: (
      query: string,
      parameters: Record<string, unknown>,
    ) => Promise<{ records: FakeRecord[] }>;
    transactionRun?: (
      query: string,
      parameters: Record<string, unknown>,
    ) => Promise<{ records: FakeRecord[] }>;
    transactionCommit?: () => Promise<void>;
  } = {},
) {
  const close = vi.fn(async () => undefined);
  const executeQuery = vi.fn(options.executeQuery ?? (async () => ({ records: [] })));
  const run = vi.fn(
    options.transactionRun ?? options.executeQuery ?? (async () => ({ records: [] })),
  );
  const sessionClose = vi.fn(async () => undefined);
  const transactionCommit = vi.fn(options.transactionCommit ?? (async () => undefined));
  const transactionRollback = vi.fn(async () => undefined);
  const session = vi.fn(() => {
    let open = true;
    return {
      beginTransaction: () =>
        ({
          run,
          commit: async () => {
            open = false;
            await transactionCommit();
          },
          rollback: async () => {
            open = false;
            await transactionRollback();
          },
          isOpen: () => open,
        }) as unknown as ManagedTransaction,
      close: sessionClose,
    };
  });
  return {
    value: { close, executeQuery, session } as unknown as Driver,
    close,
    executeQuery,
    run,
    session,
    sessionClose,
    transactionCommit,
    transactionRollback,
  };
}

function existingVectorIndex(name: string) {
  return {
    name,
    property: "embedding",
    dimensions: 2,
    similarity: "cosine" as const,
  };
}

function managed(client: Neo4jClient) {
  return client.managedKnowledgeGraph({
    name: "support",
    schema,
    resources: {
      labels: {
        document: "SupportDocument",
        chunk: "SupportChunk",
        entity: "SupportEntity",
      },
      indexes: {
        chunks: {
          vector: { name: "support_chunks_vector", dimensions: 2, similarity: "cosine" },
          fulltext: { name: "support_chunks_text" },
        },
        entities: {
          vector: { name: "support_entities_vector", dimensions: 2, similarity: "cosine" },
          fulltext: { name: "support_entities_text", properties: ["name", "title"] },
        },
      },
    },
  });
}

function replacement() {
  const productKey = 'Product:{"id":"checkout"}';
  const incidentKey = 'Incident:{"id":"INC-1"}';
  return {
    documents: [{ id: "doc-1", properties: { source: "test" } }],
    chunks: [
      {
        id: "chunk-1",
        document: {
          id: "chunk-1",
          documentId: "doc-1",
          index: 0,
          text: "Checkout incident.",
        },
        embeddings: [{ document: "Checkout incident.", vector: [1, 0] }],
      },
    ],
    entities: [
      {
        id: productKey,
        document: {
          key: productKey,
          type: "Product" as const,
          identity: { id: "checkout" },
          properties: { id: "checkout", name: "Checkout" },
          sourceChunkIds: ["chunk-1"],
        },
        embeddings: [{ document: "Checkout", vector: [1, 0] }],
      },
      {
        id: incidentKey,
        document: {
          key: incidentKey,
          type: "Incident" as const,
          identity: { id: "INC-1" },
          properties: { id: "INC-1", title: "Checkout down" },
          sourceChunkIds: ["chunk-1"],
        },
        embeddings: [{ document: "Checkout down", vector: [1, 0] }],
      },
    ],
    relationships: [
      {
        key: `AFFECTS:${incidentKey}->${productKey}:{}`,
        type: "AFFECTS" as const,
        from: incidentKey,
        to: productKey,
        properties: { severity: "high" as const },
        sourceChunkIds: ["chunk-1"],
      },
    ],
    mentions: [
      { chunkId: "chunk-1", entityKey: productKey },
      { chunkId: "chunk-1", entityKey: incidentKey },
    ],
    conflict: "overwrite" as const,
    orphanEntities: "delete" as const,
  };
}

function replacementSnapshotRecords(query: string): FakeRecord[] | undefined {
  const input = replacement();
  const product = input.entities[0];
  const incident = input.entities[1];
  const relationship = input.relationships[0];
  if (product === undefined || incident === undefined || relationship === undefined) {
    throw new Error("Expected complete replacement fixture.");
  }
  if (query.includes("AS key, properties(d) AS properties")) {
    return [record({ key: "doc-1", properties: { __anvia_id: "doc-1", source: "test" } })];
  }
  if (query.includes("AS key, properties(c) AS properties")) {
    return [
      record({
        key: "chunk-1",
        properties: {
          __anvia_id: "chunk-1",
          __anvia_document_id: "doc-1",
          __anvia_index: 0,
          __anvia_text: "Checkout incident.",
          __anvia_embedding: [1, 0],
        },
      }),
    ];
  }
  if (query.includes("labels(e) AS labels")) {
    return [product, incident].map((entity) =>
      record({
        key: entity.id,
        labels: ["SupportEntity", entity.document.type],
        properties: {
          ...entity.document.properties,
          __anvia_key: entity.id,
          __anvia_graph: "support",
          __anvia_embedding: [1, 0],
          __anvia_source_document_ids: ["doc-1"],
          __anvia_source_chunk_ids: ["chunk-1"],
        },
      }),
    );
  }
  if (query.includes("type(r) AS type")) {
    return [
      record({
        key: relationship.key,
        type: relationship.type,
        source: relationship.from,
        target: relationship.to,
        properties: {
          ...relationship.properties,
          __anvia_key: relationship.key,
          __anvia_graph: "support",
          __anvia_source_document_ids: ["doc-1"],
          __anvia_source_chunk_ids: ["chunk-1"],
        },
      }),
    ];
  }
  if (query.includes("AS chunkId") && query.includes("ANVIA_MENTIONS")) {
    return input.mentions.map((mention) => record(mention));
  }
  return undefined;
}

describe("Neo4j schema and lifecycle", () => {
  it("exports separate managed and existing immutable registrations", () => {
    const driver = fakeDriver();
    const client = new Neo4jClient({ driver: driver.value });
    const writable = managed(client);
    const existing = client.knowledgeGraph({
      schema,
      seeds: {
        knowledge: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("entities"),
        },
      },
    });
    expect(writable).toBeInstanceOf(ManagedNeo4jKnowledgeGraph);
    expect(existing).toBeInstanceOf(Neo4jKnowledgeGraph);
    expect(existing).not.toHaveProperty("ensure");
    expect(existing).not.toHaveProperty("replaceDocuments");
    expect(existing).not.toHaveProperty("createSearchTool");
    expect(writable).not.toHaveProperty("createSearchTool");
    expect(Object.isFrozen(schema.nodes)).toBe(true);
    expect(Object.isFrozen(schema.nodes.Product?.identity)).toBe(true);
    expect(Object.isFrozen(writable.resources)).toBe(true);
    expect(Object.isFrozen(writable.resources.indexes.entities.fulltext?.properties)).toBe(true);
    expect(Object.isFrozen(existing.seeds.knowledge?.labels)).toBe(true);
    expect(driver.executeQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid graph schemas and reserved properties", () => {
    expect(() =>
      defineNeo4jGraphSchema({
        nodes: {
          Product: {
            description: "Product",
            identity: ["missing"],
            properties: z.strictObject({ id: z.string() }),
          },
        },
        relationships: {},
      }),
    ).toThrow("not declared");
    expect(() =>
      defineNeo4jGraphSchema({
        nodes: {
          Product: {
            description: "Product",
            identity: ["id"],
            properties: z.strictObject({ id: z.string(), __anvia_bad: z.string() }),
          },
        },
        relationships: {},
      }),
    ).toThrow("reserved");
  });

  it("rejects schemas that can strip or alter stored property values", () => {
    const graphSchema = (properties: z.ZodObject) => () =>
      defineNeo4jGraphSchema({
        nodes: {
          Product: {
            description: "Product",
            identity: ["id"],
            properties,
          },
        },
        relationships: {},
      });

    expect(graphSchema(z.object({ id: z.string() }))).toThrow("strict Zod object");
    expect(graphSchema(z.strictObject({ id: z.coerce.string() }))).toThrow("must not coerce");
    expect(graphSchema(z.strictObject({ id: z.string().default("unknown") }))).toThrow(
      "must not coerce",
    );
    expect(graphSchema(z.strictObject({ id: z.string().transform((value) => value) }))).toThrow(
      "must not coerce",
    );
    expect(graphSchema(z.strictObject({ id: z.string().trim() }))).toThrow("must not normalize");
  });

  it("rejects vector similarities outside the public allowlist", () => {
    const driver = fakeDriver();
    expect(() =>
      new Neo4jClient({ driver: driver.value }).managedKnowledgeGraph({
        name: "invalid",
        schema,
        resources: {
          labels: { document: "Document", chunk: "Chunk", entity: "Entity" },
          indexes: {
            chunks: {
              vector: {
                name: "chunks",
                dimensions: 2,
                similarity: "cosine' RETURN 1 //" as never,
              },
            },
            entities: {
              vector: { name: "entities", dimensions: 2, similarity: "cosine" },
            },
          },
        },
      }),
    ).toThrow("similarity");
  });

  it("does not close caller-owned drivers", async () => {
    const driver = fakeDriver();
    const client = new Neo4jClient({ driver: driver.value });
    await client.close();
    expect(driver.close).not.toHaveBeenCalled();
    expect(() => client.nativeDriver()).toThrow("closed");
  });

  it("supports async disposal without closing caller-owned drivers", async () => {
    const driver = fakeDriver();
    const client = new Neo4jClient({ driver: driver.value });
    await client[Symbol.asyncDispose]();
    expect(driver.close).not.toHaveBeenCalled();
    expect(() => client.nativeDriver()).toThrow("closed");
  });

  it("explicitly provisions constraints and indexes and validates Neo4j 2026", async () => {
    const driver = fakeDriver({
      executeQuery: async (query, _parameters) => {
        if (query.includes("dbms.components"))
          return { records: [record({ version: "2026.01.0" })] };
        if (query.startsWith("SHOW INDEXES")) {
          return {
            records: [
              record({
                name: "support_chunks_vector",
                state: "ONLINE",
                type: "VECTOR",
                entityType: "NODE",
                labelsOrTypes: ["SupportChunk"],
                properties: ["__anvia_embedding"],
                options: {
                  indexConfig: {
                    "vector.dimensions": 2,
                    "vector.similarity_function": "cosine",
                  },
                },
              }),
              record({
                name: "support_chunks_text",
                state: "ONLINE",
                type: "FULLTEXT",
                entityType: "NODE",
                labelsOrTypes: ["SupportChunk"],
                properties: ["__anvia_text"],
                options: {},
              }),
              record({
                name: "support_entities_vector",
                state: "ONLINE",
                type: "VECTOR",
                entityType: "NODE",
                labelsOrTypes: ["SupportEntity"],
                properties: ["__anvia_embedding"],
                options: {
                  indexConfig: {
                    "vector.dimensions": 2,
                    "vector.similarity_function": "cosine",
                  },
                },
              }),
              record({
                name: "support_entities_text",
                state: "ONLINE",
                type: "FULLTEXT",
                entityType: "NODE",
                labelsOrTypes: ["SupportEntity"],
                properties: ["name", "title"],
                options: {},
              }),
            ],
          };
        }
        if (query.startsWith("SHOW CONSTRAINTS")) {
          return {
            records: [
              ["document", "SupportDocument", ["__anvia_id"]],
              ["chunk", "SupportChunk", ["__anvia_id"]],
              ["entity", "SupportEntity", ["__anvia_key"]],
              ["entity_Product", "Product", ["id"]],
              ["entity_Incident", "Incident", ["id"]],
            ].map(([suffix, label, properties]) =>
              record({
                name: `anvia_support_${suffix}_identity`,
                type: "UNIQUENESS",
                entityType: "NODE",
                labelsOrTypes: [label],
                properties,
              }),
            ),
          };
        }
        return { records: [] };
      },
    });
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    await graph.ensure({ indexTimeoutMs: 1_000 });
    expect(
      driver.run.mock.calls.some(([query]) => String(query).includes("CREATE VECTOR INDEX")),
    ).toBe(true);
    expect(driver.run.mock.calls.some(([query]) => String(query).includes("db.awaitIndexes"))).toBe(
      true,
    );
    expect(driver.executeQuery).not.toHaveBeenCalled();
  });

  it("rejects an online index whose definition does not match the registration", async () => {
    const driver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("dbms.components")) {
          return { records: [record({ version: "2026.01.0" })] };
        }
        if (query.startsWith("SHOW INDEXES")) {
          return {
            records: [
              record({
                name: "incident_vectors",
                state: "ONLINE",
                type: "VECTOR",
                entityType: "NODE",
                labelsOrTypes: ["Incident"],
                properties: ["embedding"],
                options: {
                  indexConfig: {
                    "vector.dimensions": 99,
                    "vector.similarity_function": "cosine",
                  },
                },
              }),
            ],
          };
        }
        return { records: [] };
      },
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        incidents: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    await expect(graph.validate()).rejects.toThrow("incompatible vector configuration");
  });

  it("rolls back an in-flight query on abort without driver-managed retries", async () => {
    let started: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const driver = fakeDriver({
      transactionRun: async () => {
        started?.();
        return await new Promise<{ records: FakeRecord[] }>(() => undefined);
      },
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        incidents: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    const controller = new AbortController();
    const validation = graph.validate({ abortSignal: controller.signal });
    await queryStarted;
    controller.abort();
    await expect(validation).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.run).toHaveBeenCalledOnce();
    expect(driver.transactionRollback).toHaveBeenCalledOnce();
    expect(driver.executeQuery).not.toHaveBeenCalled();
  });

  it("returns a committed result when abort arrives during a successful commit", async () => {
    const controller = new AbortController();
    const driver = fakeDriver({
      transactionCommit: async () => controller.abort(),
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        incidents: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    const result = await graph.query("RETURN 1", {}, controller.signal);
    expect(result.records).toEqual([]);
    expect(driver.transactionCommit).toHaveBeenCalledOnce();
    expect(driver.transactionRollback).not.toHaveBeenCalled();
  });
});

describe("extractGraphFacts", () => {
  beforeEach(() => extractMock.mockReset());

  it("deduplicates identities, preserves provenance, and validates endpoints", async () => {
    extractMock
      .mockResolvedValueOnce({
        output: {
          entities: [
            {
              ref: "incident",
              type: "Incident",
              properties: { id: "INC-1", title: "Checkout down" },
            },
            { ref: "product", type: "Product", properties: { id: "checkout", name: "Checkout" } },
          ],
          relationships: [
            { type: "AFFECTS", from: "incident", to: "product", properties: { severity: "high" } },
          ],
        },
        usage: Usage.empty(),
      })
      .mockResolvedValueOnce({
        output: {
          entities: [
            { ref: "product", type: "Product", properties: { id: "checkout", name: "Checkout" } },
          ],
          relationships: [],
        },
        usage: Usage.empty(),
      });
    const result = await extractGraphFacts({
      model: {} as never,
      schema,
      chunks: [
        { id: "chunk-1", documentId: "doc-1", index: 0, text: "Incident." },
        { id: "chunk-2", documentId: "doc-2", index: 0, text: "Checkout." },
      ],
      concurrency: 2,
    });
    expect(result.output.entities).toHaveLength(2);
    expect(
      result.output.entities.find((entity) => entity.type === "Product")?.sourceChunkIds,
    ).toEqual(["chunk-1", "chunk-2"]);
    expect(result.output.relationships[0]).toMatchObject({
      type: "AFFECTS",
      sourceChunkIds: ["chunk-1"],
    });
  });

  it("rejects conflicting properties instead of choosing silently", async () => {
    extractMock
      .mockResolvedValueOnce({
        output: {
          entities: [{ ref: "p", type: "Product", properties: { id: "p1", name: "One" } }],
          relationships: [],
        },
        usage: Usage.empty(),
      })
      .mockResolvedValueOnce({
        output: {
          entities: [{ ref: "p", type: "Product", properties: { id: "p1", name: "Two" } }],
          relationships: [],
        },
        usage: Usage.empty(),
      });
    await expect(
      extractGraphFacts({
        model: {} as never,
        schema,
        chunks: [
          { id: "a", documentId: "a", index: 0, text: "a" },
          { id: "b", documentId: "b", index: 0, text: "b" },
        ],
      }),
    ).rejects.toBeInstanceOf(GraphFactConflictError);
  });
});

describe("managed graph writes", () => {
  it("replaces document-scoped graph state in one transaction", async () => {
    const driver = fakeDriver({
      transactionRun: async (query) =>
        query.includes("collect(c.") ? { records: [record({ chunkIds: [] })] } : { records: [] },
    });
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    await graph.replaceDocuments(replacement());
    expect(driver.session).toHaveBeenCalledOnce();
    expect(driver.run.mock.calls.some(([query]) => String(query).includes("ANVIA_MENTIONS"))).toBe(
      true,
    );
    expect(
      driver.run.mock.calls.some(([query]) => String(query).includes("__anvia_source_chunk_ids")),
    ).toBe(true);
    expect(
      driver.run.mock.calls.some(([query]) => String(query).includes("SET e = row.properties")),
    ).toBe(true);
    expect(
      driver.run.mock.calls.some(([query]) => String(query).includes("SET r = row.properties")),
    ).toBe(true);
    expect(driver.sessionClose).toHaveBeenCalledOnce();
  });

  it("returns exact logical changes for new graph state", async () => {
    let written = false;
    const driver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("collect(c.")) return { records: [record({ chunkIds: [] })] };
        if (query.includes("MERGE (d:")) written = true;
        const records = written ? replacementSnapshotRecords(query) : undefined;
        return { records: records ?? [] };
      },
    });
    const result = await managed(new Neo4jClient({ driver: driver.value })).replaceDocuments(
      replacement(),
    );
    expect(result).toEqual({
      documents: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      chunks: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      entities: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
      relationships: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      mentions: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
    });
  });

  it("reports identical replacements as unchanged for every conflict policy", async () => {
    for (const conflict of ["error", "overwrite", "keep-existing"] as const) {
      const driver = fakeDriver({
        transactionRun: async (query, parameters) => {
          if (query.includes("collect(c.")) {
            return { records: [record({ chunkIds: ["chunk-1"] })] };
          }
          if (query.includes("RETURN key, properties(e) AS properties")) {
            const input = replacement();
            const keys = Array.isArray(parameters.keys) ? parameters.keys : [];
            return {
              records: input.entities
                .filter((entity) => keys.includes(entity.id))
                .map((entity) =>
                  record({ key: entity.id, properties: entity.document.properties }),
                ),
            };
          }
          if (query.includes("RETURN key, properties(r) AS properties")) {
            const item = replacement().relationships[0];
            return item === undefined
              ? { records: [] }
              : { records: [record({ key: item.key, properties: item.properties })] };
          }
          void parameters;
          return { records: replacementSnapshotRecords(query) ?? [] };
        },
      });
      const input = replacement();
      const result = await managed(new Neo4jClient({ driver: driver.value })).replaceDocuments({
        ...input,
        conflict,
      });
      expect(result).toEqual({
        documents: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        chunks: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        entities: { created: 0, updated: 0, deleted: 0, unchanged: 2 },
        relationships: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        mentions: { created: 0, updated: 0, deleted: 0, unchanged: 2 },
      });
    }
  });

  it("returns zero changes for empty write operations without opening a session", async () => {
    const driver = fakeDriver();
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    const input = replacement();
    await expect(
      graph.replaceDocuments({
        ...input,
        documents: [],
        chunks: [],
        entities: [],
        relationships: [],
        mentions: [],
      }),
    ).resolves.toEqual({
      documents: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      chunks: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      entities: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      mentions: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
    });
    await expect(
      graph.deleteDocuments({ documentIds: [], orphanEntities: "delete" }),
    ).resolves.toEqual({
      documents: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      chunks: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      entities: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      relationships: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      mentions: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
    });
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("reports orphan keep and delete outcomes without touching unrelated graph state", async () => {
    for (const orphanEntities of ["keep", "delete"] as const) {
      let removed = false;
      const driver = fakeDriver({
        transactionRun: async (query) => {
          if (!removed) {
            const records = replacementSnapshotRecords(query);
            if (records !== undefined) return { records };
          }
          if (query.includes("collect(c.")) {
            removed = true;
            return { records: [record({ chunkIds: ["chunk-1"] })] };
          }
          if (removed && orphanEntities === "keep" && query.includes("labels(e) AS labels")) {
            const records = replacementSnapshotRecords(query) ?? [];
            return {
              records: records.map((item) => {
                const properties = item.get("properties");
                if (typeof properties !== "object" || properties === null) return item;
                return record({
                  key: item.get("key"),
                  labels: item.get("labels"),
                  properties: {
                    ...(properties as Record<string, unknown>),
                    __anvia_source_document_ids: [],
                    __anvia_source_chunk_ids: [],
                  },
                });
              }),
            };
          }
          return { records: [] };
        },
      });
      const result = await managed(new Neo4jClient({ driver: driver.value })).deleteDocuments({
        documentIds: ["doc-1"],
        orphanEntities,
      });
      expect(result).toEqual({
        documents: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        chunks: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        entities:
          orphanEntities === "keep"
            ? { created: 0, updated: 2, deleted: 0, unchanged: 0 }
            : { created: 0, updated: 0, deleted: 2, unchanged: 0 },
        relationships: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        mentions: { created: 0, updated: 0, deleted: 2, unchanged: 0 },
      });
      expect(
        driver.run.mock.calls.some(
          ([query]) =>
            String(query).includes("$deleteOrphans") &&
            String(query).includes("id IN $documentIds"),
        ),
      ).toBe(true);
    }
  });

  it("rolls back without returning a partial write result", async () => {
    const driver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("collect(c.")) return { records: [record({ chunkIds: [] })] };
        if (query.includes("MERGE (d:")) throw new Error("write failed");
        return { records: [] };
      },
    });
    await expect(
      managed(new Neo4jClient({ driver: driver.value })).replaceDocuments(replacement()),
    ).rejects.toThrow("write failed");
    expect(driver.transactionCommit).not.toHaveBeenCalled();
    expect(driver.transactionRollback).toHaveBeenCalledOnce();
  });

  it("rejects malformed graph references and policies before deleting previous state", async () => {
    const driver = fakeDriver();
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    const input = replacement();
    const relationship = input.relationships[0];
    if (relationship === undefined) throw new Error("Expected a relationship fixture.");
    await expect(
      graph.replaceDocuments({
        ...input,
        relationships: [{ ...relationship, to: "missing" }],
      }),
    ).rejects.toThrow("unknown entity");
    await expect(graph.replaceDocuments({ ...input, conflict: "merge" as never })).rejects.toThrow(
      "conflict policy",
    );
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("requires relationship provenance to support both endpoint entities", async () => {
    const driver = fakeDriver();
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    const input = replacement();
    const relationship = input.relationships[0];
    const product = input.entities[0];
    const incident = input.entities[1];
    if (relationship === undefined || product === undefined || incident === undefined) {
      throw new Error("Expected complete replacement fixture.");
    }
    await expect(
      graph.replaceDocuments({
        ...input,
        documents: [...input.documents, { id: "doc-2" }],
        chunks: [
          ...input.chunks,
          {
            id: "chunk-2",
            document: {
              id: "chunk-2",
              documentId: "doc-2",
              index: 0,
              text: "Additional evidence.",
            },
            embeddings: [{ document: "Additional evidence.", vector: [0, 1] }],
          },
        ],
        entities: [
          product,
          {
            ...incident,
            document: {
              ...incident.document,
              sourceChunkIds: ["chunk-1", "chunk-2"],
            },
          },
        ],
        relationships: [{ ...relationship, sourceChunkIds: ["chunk-2"] }],
        mentions: [...input.mentions, { chunkId: "chunk-2", entityKey: incident.id }],
      }),
    ).rejects.toThrow("must support both endpoint entities");
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("requires entity provenance to exactly match mention edges", async () => {
    const driver = fakeDriver();
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    const input = replacement();
    await expect(
      graph.replaceDocuments({ ...input, mentions: input.mentions.slice(0, 1) }),
    ).rejects.toThrow("source chunks must exactly match its mentions");
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("rejects mismatched embeddings before writing", async () => {
    const driver = fakeDriver();
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    await expect(
      graph.replaceDocuments({
        documents: [{ id: "doc" }],
        chunks: [
          {
            id: "chunk",
            document: { id: "chunk", documentId: "doc", index: 0, text: "text" },
            embeddings: [{ document: "text", vector: [1] }],
          },
        ],
        entities: [],
        relationships: [],
        mentions: [],
        conflict: "error",
        orphanEntities: "keep",
      }),
    ).rejects.toThrow("2-dimension");
    expect(driver.session).not.toHaveBeenCalled();
  });
});

describe("graph retrieval", () => {
  const model: EmbeddingModel = {
    provider: "test",
    modelId: "embedding",
    dimensions: 2,
    async embedTexts(texts) {
      return texts.map((document) => ({ document, vector: [1, 0] }));
    },
  };

  const traversal = {
    relationships: ["AFFECTS" as const],
    direction: "both" as const,
    maxDepth: 1,
    maxNodes: 10,
    maxRelationships: 10,
  };

  it("rejects incompatible selected seed dimensions before embedding", async () => {
    const driver = fakeDriver();
    const embedTexts = vi.fn(async (texts: string[]) =>
      texts.map((document) => ({ document, vector: [1, 0] })),
    );
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        incidents: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
          fulltextIndex: { name: "incident_text", properties: ["title"] },
        },
        products: {
          nodeTypes: ["Product"],
          vectorIndex: { ...existingVectorIndex("product_vectors"), dimensions: 3 },
          fulltextIndex: { name: "product_text", properties: ["name"] },
        },
      },
    });
    await expect(
      retrieveGraphContext({
        graph,
        model: { provider: "test", modelId: "embedding", embedTexts },
        query: "checkout",
        search: {
          type: "hybrid",
          seeds: ["incidents", "products"],
          topK: 2,
          candidatesPerSeed: 2,
          rrfK: 60,
        },
        traversal,
        evidence: { type: "none" },
      }),
    ).rejects.toThrow("same vector dimensions");
    expect(embedTexts).not.toHaveBeenCalled();
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("rejects declared and produced embedding dimension mismatches before searching", async () => {
    const declaredDriver = fakeDriver();
    const declaredEmbedTexts = vi.fn(async (texts: string[]) =>
      texts.map((document) => ({ document, vector: [1, 0, 0] })),
    );
    await expect(
      retrieveGraphContext({
        graph: managed(new Neo4jClient({ driver: declaredDriver.value })),
        model: {
          provider: "test",
          modelId: "declared-mismatch",
          dimensions: 3,
          embedTexts: declaredEmbedTexts,
        },
        query: "checkout",
        search: { type: "vector", seeds: ["entities"], topK: 1 },
        traversal,
        evidence: { type: "none" },
      }),
    ).rejects.toThrow("do not match Neo4j graph dimensions");
    expect(declaredEmbedTexts).not.toHaveBeenCalled();
    expect(declaredDriver.session).not.toHaveBeenCalled();

    const producedDriver = fakeDriver();
    const producedEmbedTexts = vi.fn(async (texts: string[]) =>
      texts.map((document) => ({ document, vector: [1, 0, 0] })),
    );
    await expect(
      retrieveGraphContext({
        graph: managed(new Neo4jClient({ driver: producedDriver.value })),
        model: {
          provider: "test",
          modelId: "produced-mismatch",
          embedTexts: producedEmbedTexts,
        },
        query: "checkout",
        search: { type: "vector", seeds: ["entities"], topK: 1 },
        traversal,
        evidence: { type: "none" },
      }),
    ).rejects.toThrow("Query embedding dimensions 3");
    expect(producedEmbedTexts).toHaveBeenCalledOnce();
    expect(producedDriver.session).not.toHaveBeenCalled();
  });

  it("rejects unknown traversal directions before embedding or querying", async () => {
    const driver = fakeDriver();
    const embedTexts = vi.fn(async (texts: string[]) =>
      texts.map((document) => ({ document, vector: [1, 0] })),
    );
    await expect(
      retrieveGraphContext({
        graph: managed(new Neo4jClient({ driver: driver.value })),
        model: { provider: "test", modelId: "embedding", dimensions: 2, embedTexts },
        query: "checkout",
        search: { type: "vector", seeds: ["entities"], topK: 1 },
        traversal: { ...traversal, direction: "sideways" as never },
        evidence: { type: "none" },
      }),
    ).rejects.toThrow("direction must be outgoing, incoming, or both");
    expect(embedTexts).not.toHaveBeenCalled();
    expect(driver.session).not.toHaveBeenCalled();
  });

  it("uses SEARCH seeds, bounded traversal, and strict serializable results", async () => {
    const driver = fakeDriver({
      executeQuery: async (query) => {
        if (query.includes("SEARCH seed")) {
          return {
            records: [
              record({
                elementId: "4:seed",
                labels: ["Incident"],
                properties: {
                  id: "INC-1",
                  title: "Checkout down",
                  __anvia_key: 'Incident:{"id":"INC-1"}',
                },
                score: 0.9,
              }),
            ],
          };
        }
        if (query.includes("MATCH path")) {
          return {
            records: [
              record({
                nodes: [
                  {
                    elementId: "4:seed",
                    labels: ["Incident"],
                    properties: {
                      id: "INC-1",
                      title: "Checkout down",
                      __anvia_key: 'Incident:{"id":"INC-1"}',
                    },
                  },
                  {
                    elementId: "4:product",
                    labels: ["Product"],
                    properties: {
                      id: "checkout",
                      name: "Checkout",
                      __anvia_key: 'Product:{"id":"checkout"}',
                    },
                  },
                ],
                relationships: [
                  {
                    elementId: "5:rel",
                    type: "AFFECTS",
                    from: "4:seed",
                    to: "4:product",
                    properties: { severity: "high" },
                  },
                ],
              }),
            ],
          };
        }
        return { records: [] };
      },
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        knowledge: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    const context = await retrieveGraphContext({
      graph,
      model,
      query: "What affects checkout?",
      search: { type: "vector", seeds: ["knowledge"], topK: 3 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 2,
        maxNodes: 10,
        maxRelationships: 10,
      },
      evidence: { type: "none" },
    });
    expect(context.seeds[0]).toMatchObject({ type: "Incident", score: 0.9 });
    expect(context.nodes).toHaveLength(2);
    expect(context.relationships[0]).toMatchObject({
      type: "AFFECTS",
      from: 'Incident:{"id":"INC-1"}',
      to: 'Product:{"id":"checkout"}',
      properties: { severity: "high" },
    });
    expect(driver.run.mock.calls.some(([query]) => String(query).includes("AS chunkId"))).toBe(
      false,
    );
    expect(driver.run.mock.calls[0]?.[0]).toContain("SEARCH seed");
  });

  it("enforces maxNodes across seeds and omits relationships with hidden endpoints", async () => {
    const incidentKey = 'Incident:{"id":"INC-1"}';
    const productKey = 'Product:{"id":"checkout"}';
    const incident = {
      elementId: "4:incident",
      labels: ["Incident"],
      properties: { id: "INC-1", title: "Down", __anvia_key: incidentKey },
    };
    const product = {
      elementId: "4:product",
      labels: ["Product"],
      properties: { id: "checkout", name: "Checkout", __anvia_key: productKey },
    };
    const driver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("SEARCH seed")) {
          return {
            records: [record({ ...incident, score: 0.9 }), record({ ...product, score: 0.8 })],
          };
        }
        if (query.includes("RETURN {elementId")) {
          return { records: [record({ node: incident })] };
        }
        if (query.includes("MATCH path")) {
          return {
            records: [
              record({
                nodes: [incident, product],
                relationships: [
                  {
                    elementId: "5:affects",
                    type: "AFFECTS",
                    from: incident.elementId,
                    to: product.elementId,
                    properties: { severity: "high" },
                  },
                ],
              }),
            ],
          };
        }
        return { records: [] };
      },
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        knowledge: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    const context = await retrieveGraphContext({
      graph,
      model,
      query: "checkout",
      search: { type: "vector", seeds: ["knowledge"], topK: 2 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 1,
        maxNodes: 1,
        maxRelationships: 10,
      },
      evidence: { type: "none" },
    });
    expect(context.nodes).toEqual([
      expect.objectContaining({ key: incidentKey, type: "Incident" }),
    ]);
    expect(context.relationships).toEqual([]);
  });

  it("hydrates managed evidence once in deterministic provenance order", async () => {
    const incidentKey = 'Incident:{"id":"INC-1"}';
    const productKey = 'Product:{"id":"checkout"}';
    const incident = {
      elementId: "4:incident",
      labels: ["Incident", "SupportEntity"],
      properties: {
        id: "INC-1",
        title: "Down",
        __anvia_key: incidentKey,
        __anvia_source_chunk_ids: ["chunk-2", "chunk-1"],
      },
    };
    const product = {
      elementId: "4:product",
      labels: ["Product", "SupportEntity"],
      properties: {
        id: "checkout",
        name: "Checkout",
        __anvia_key: productKey,
        __anvia_source_chunk_ids: ["chunk-1", "chunk-3"],
      },
    };
    const evidence = (chunkId: string, index: number) =>
      record({
        chunkId,
        documentId: "doc-1",
        index,
        text: `exact ${chunkId} `,
        properties: {
          __anvia_id: chunkId,
          __anvia_text: `exact ${chunkId} `,
          topic: "checkout",
        },
      });
    const driver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("SEARCH seed")) {
          return { records: [record({ ...incident, score: 0.9 })] };
        }
        if (query.includes("RETURN {elementId")) {
          return { records: [record({ node: incident })] };
        }
        if (query.includes("MATCH path")) {
          return {
            records: [
              record({
                nodes: [incident, product],
                relationships: [
                  {
                    elementId: "5:affects",
                    type: "AFFECTS",
                    from: incident.elementId,
                    to: product.elementId,
                    properties: {
                      severity: "high",
                      __anvia_key: "affects",
                      __anvia_source_chunk_ids: ["chunk-3"],
                    },
                  },
                ],
              }),
            ],
          };
        }
        if (query.includes("AS chunkId")) {
          return {
            records: [evidence("chunk-3", 2), evidence("chunk-1", 0), evidence("chunk-2", 1)],
          };
        }
        return { records: [] };
      },
    });
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    const context = await retrieveGraphContext({
      graph,
      model,
      query: "checkout",
      search: { type: "vector", seeds: ["entities"], topK: 2 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 1,
        maxNodes: 3,
        maxRelationships: 3,
      },
      evidence: { type: "chunks", maxChunks: 3 },
    });
    expect(context.seeds[0]?.sourceChunkIds).toEqual(["chunk-2", "chunk-1"]);
    expect(context.evidence).toEqual([
      {
        chunkId: "chunk-2",
        documentId: "doc-1",
        index: 1,
        text: "exact chunk-2 ",
        metadata: { topic: "checkout" },
      },
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        index: 0,
        text: "exact chunk-1 ",
        metadata: { topic: "checkout" },
      },
      {
        chunkId: "chunk-3",
        documentId: "doc-1",
        index: 2,
        text: "exact chunk-3 ",
        metadata: { topic: "checkout" },
      },
    ]);
    expect(
      driver.run.mock.calls.filter(([query]) => String(query).includes("AS chunkId")),
    ).toHaveLength(1);
  });

  it("rejects invalid or missing managed evidence", async () => {
    const driver = fakeDriver({
      transactionRun: async (query) =>
        query.includes("SEARCH seed")
          ? {
              records: [
                record({
                  elementId: "4:entity",
                  labels: ["Product"],
                  properties: {
                    id: "checkout",
                    __anvia_key: 'Product:{"id":"checkout"}',
                    __anvia_source_chunk_ids: ["missing"],
                  },
                  score: 0.9,
                }),
              ],
            }
          : { records: [] },
    });
    const graph = managed(new Neo4jClient({ driver: driver.value }));
    await expect(
      retrieveGraphContext({
        graph,
        model,
        query: "checkout",
        search: { type: "vector", seeds: ["entities"], topK: 1 },
        traversal: {
          relationships: ["AFFECTS"],
          direction: "both",
          maxDepth: 1,
          maxNodes: 1,
          maxRelationships: 1,
        },
        evidence: { type: "chunks", maxChunks: 1 },
      }),
    ).rejects.toThrow("missing chunk missing");
    await expect(
      retrieveGraphContext({
        graph,
        model,
        query: "checkout",
        search: { type: "vector", seeds: ["entities"], topK: 1 },
        traversal: {
          relationships: ["AFFECTS"],
          direction: "both",
          maxDepth: 1,
          maxNodes: 1,
          maxRelationships: 1,
        },
        evidence: { type: "chunks", maxChunks: 0 },
      }),
    ).rejects.toThrow("positive safe integer");
  });

  it("rejects malformed evidence values and rolls back hydration on abort", async () => {
    const hit = record({
      elementId: "4:entity",
      labels: ["Product"],
      properties: {
        id: "checkout",
        __anvia_key: 'Product:{"id":"checkout"}',
        __anvia_source_chunk_ids: ["chunk-1"],
      },
      score: 0.9,
    });
    const options = {
      model,
      query: "checkout",
      search: { type: "vector" as const, seeds: ["entities"], topK: 1 },
      traversal: {
        relationships: ["AFFECTS" as const],
        direction: "both" as const,
        maxDepth: 1,
        maxNodes: 1,
        maxRelationships: 1,
      },
      evidence: { type: "chunks" as const, maxChunks: 1 },
    };
    const malformedDriver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("SEARCH seed")) return { records: [hit] };
        if (query.includes("AS chunkId")) {
          return {
            records: [
              record({
                chunkId: "chunk-1",
                documentId: "doc-1",
                index: "0",
                text: "text",
                properties: {},
              }),
            ],
          };
        }
        return { records: [] };
      },
    });
    await expect(
      retrieveGraphContext({
        ...options,
        graph: managed(new Neo4jClient({ driver: malformedDriver.value })),
      }),
    ).rejects.toThrow("safe integer");

    let evidenceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      evidenceStarted = resolve;
    });
    const abortDriver = fakeDriver({
      transactionRun: async (query) => {
        if (query.includes("SEARCH seed")) return { records: [hit] };
        if (query.includes("AS chunkId")) {
          evidenceStarted?.();
          return await new Promise<never>(() => undefined);
        }
        return { records: [] };
      },
    });
    const controller = new AbortController();
    const retrieval = retrieveGraphContext({
      ...options,
      graph: managed(new Neo4jClient({ driver: abortDriver.value })),
      abortSignal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(retrieval).rejects.toMatchObject({ name: "AbortError" });
    expect(abortDriver.transactionRollback).toHaveBeenCalledOnce();
  });

  it("creates an Agent tool with fixed retrieval limits", async () => {
    const driver = fakeDriver({
      executeQuery: async (query) =>
        query.includes("SEARCH seed") ? { records: [] } : { records: [] },
    });
    const graph = new Neo4jClient({ driver: driver.value }).knowledgeGraph({
      schema,
      seeds: {
        knowledge: {
          nodeTypes: ["Incident"],
          vectorIndex: existingVectorIndex("incident_vectors"),
        },
      },
    });
    const tool = createGraphSearchTool({
      name: "search_graph",
      description: "Search the graph.",
      graph,
      model,
      search: { type: "vector", seeds: ["knowledge"], topK: 3 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 1,
        maxNodes: 10,
        maxRelationships: 10,
      },
      evidence: { type: "none" },
    });
    await expect(tool.call({ query: "checkout" })).resolves.toEqual({
      seeds: [],
      nodes: [],
      relationships: [],
      evidence: [],
    });
    expect((await tool.definition("")).name).toBe("search_graph");
  });

  it("explores a bounded provider-neutral graph view", async () => {
    const driver = fakeDriver({
      executeQuery: async (query) => {
        if (query.includes("RETURN elementId(node) AS id")) {
          return {
            records: [
              record({
                id: "node-1",
                labels: ["SupportEntity", "Incident"],
                properties: {
                  id: "INC-1",
                  title: "Checkout unavailable",
                  __anvia_key: 'Incident:{"id":"INC-1"}',
                  __anvia_embedding: [1, 0],
                },
              }),
              record({
                id: "node-2",
                labels: ["SupportEntity", "Product"],
                properties: { id: "checkout", name: "Checkout" },
              }),
            ],
          };
        }
        if (query.includes("MATCH (from)-[relationship]->(to)")) {
          return {
            records: [
              record({
                id: "relationship-1",
                type: "AFFECTS",
                source: "node-1",
                target: "node-2",
                properties: { severity: "high", __anvia_graph: "support" },
              }),
            ],
          };
        }
        return { records: [] };
      },
    });
    const result = await managed(new Neo4jClient({ driver: driver.value })).explore({
      mode: "overview",
      maxNodes: 10,
      maxRelationships: 10,
    });
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      id: "node-1",
      type: "Incident",
      identity: { id: "INC-1" },
      properties: { id: "INC-1", title: "Checkout unavailable" },
    });
    expect(result.nodes[0]?.properties).not.toHaveProperty("__anvia_embedding");
    expect(result.relationships[0]).toMatchObject({
      type: "AFFECTS",
      from: "node-1",
      to: "node-2",
      properties: { severity: "high" },
    });
  });
});
