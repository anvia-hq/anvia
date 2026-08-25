import type { EmbeddingModel } from "@anvia/core/embeddings";
import { defineGraphSchema } from "@anvia/graph";
import type { Driver, ManagedTransaction } from "neo4j-driver";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MemgraphClient } from "../src/index.js";

type FakeRecord = { keys: string[]; get(key: string): unknown };

function record(value: Record<string, unknown>): FakeRecord {
  return { keys: Object.keys(value), get: (key) => value[key] };
}

function fakeDriver(
  runQuery: (
    query: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ records: FakeRecord[] }> = async () => ({ records: [] }),
) {
  const close = vi.fn(async () => undefined);
  const run = vi.fn(runQuery);
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const session = vi.fn(() => {
    let open = true;
    return {
      run,
      beginTransaction: () =>
        ({
          run,
          commit: async () => {
            open = false;
            await commit();
          },
          rollback: async () => {
            open = false;
            await rollback();
          },
          isOpen: () => open,
        }) as unknown as ManagedTransaction,
      close: vi.fn(async () => undefined),
    };
  });
  return { value: { close, session } as unknown as Driver, close, run, session, commit, rollback };
}

const schema = defineGraphSchema({
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
      properties: z.strictObject({ severity: z.string() }),
    },
  },
});

function managed(client: MemgraphClient) {
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
          text: { name: "support_chunks_text" },
        },
        entities: {
          vector: {
            name: "support_entities_vector",
            dimensions: 2,
            similarity: "cosine",
            capacity: 2048,
            scalarKind: "f16",
          },
          text: { name: "support_entities_text", properties: ["name", "title"] },
        },
      },
    },
  });
}

describe("MemgraphClient", () => {
  it("keeps a caller-owned driver open", async () => {
    const driver = fakeDriver();
    const client = new MemgraphClient({ driver: driver.value });
    expect(client.nativeDriver()).toBe(driver.value);
    await client.close();
    expect(driver.close).not.toHaveBeenCalled();
    expect(() => client.nativeDriver()).toThrow("closed");
  });

  it("provisions Memgraph-native constraints, lookup, vector, and text indexes", async () => {
    let constraintsCreated = false;
    let lookupCreated = false;
    const vectors = new Set<string>();
    const texts = new Set<string>();
    const queries: string[] = [];
    const constraints = [
      ["SupportDocument", ["__anvia_id"]],
      ["SupportChunk", ["__anvia_id"]],
      ["SupportEntity", ["__anvia_key"]],
      ["Product", ["id"]],
      ["Incident", ["id"]],
    ] as const;
    const driver = fakeDriver(async (query) => {
      queries.push(query);
      if (query === "SHOW VERSION") return { records: [record({ version: "Memgraph v3.9.0" })] };
      if (query === "SHOW CONSTRAINT INFO") {
        return {
          records: constraintsCreated
            ? constraints.map(([label, properties]) =>
                record({ "constraint type": "unique", label, properties: [...properties] }),
              )
            : [],
        };
      }
      if (query.startsWith("CREATE CONSTRAINT")) {
        constraintsCreated = true;
        return { records: [] };
      }
      if (query.startsWith("CREATE INDEX ON")) {
        lookupCreated = true;
        return { records: [] };
      }
      if (query.startsWith("CREATE VECTOR INDEX")) {
        if (query.includes("support_chunks_vector")) vectors.add("support_chunks_vector");
        if (query.includes("support_entities_vector")) vectors.add("support_entities_vector");
        return { records: [] };
      }
      if (query.startsWith("CREATE TEXT INDEX")) {
        if (query.includes("support_chunks_text")) texts.add("support_chunks_text");
        if (query.includes("support_entities_text")) texts.add("support_entities_text");
        return { records: [] };
      }
      if (query.includes("vector_search.show_index_info")) {
        return {
          records: [...vectors].map((name) => {
            const chunks = name.includes("chunks");
            return record({
              index_name: name,
              label: chunks ? ":SupportChunk" : ":SupportEntity",
              property: "__anvia_embedding",
              dimension: 2,
              metric: "cos",
            });
          }),
        };
      }
      if (query === "SHOW INDEX INFO") {
        const records = [...texts].map((name) => record({ type: "text", name }));
        if (lookupCreated) {
          records.unshift(
            ...constraints.map(([label, properties]) =>
              record({ type: "label+property", label, properties: [...properties] }),
            ),
          );
        }
        return {
          records,
        };
      }
      return { records: [] };
    });
    await managed(new MemgraphClient({ driver: driver.value })).ensure();
    expect(queries.some((query) => query.includes("CREATE VECTOR INDEX"))).toBe(true);
    expect(queries.some((query) => query.includes('"scalar_kind":"f16"'))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TEXT INDEX"))).toBe(true);
  });

  it("uses Memgraph vector search and bounded BFS traversal", async () => {
    const queries: string[] = [];
    const driver = fakeDriver(async (query) => {
      queries.push(query);
      if (query.includes("vector_search.search(")) {
        return {
          records: [
            record({
              internalId: 1,
              labels: ["SupportEntity", "Incident"],
              properties: {
                id: "INC-1",
                title: "Checkout down",
                __anvia_key: 'Incident:{"id":"INC-1"}',
                __anvia_source_chunk_ids: ["chunk-1"],
              },
              score: 0.9,
            }),
          ],
        };
      }
      if (query.includes("RETURN {internalId: id(node)")) {
        return {
          records: [
            record({
              node: {
                internalId: 1,
                labels: ["Incident"],
                properties: {
                  id: "INC-1",
                  title: "Checkout down",
                  __anvia_key: 'Incident:{"id":"INC-1"}',
                },
              },
            }),
          ],
        };
      }
      if (query.includes("MATCH path")) return { records: [] };
      return { records: [] };
    });
    const model: EmbeddingModel = {
      provider: "test",
      modelId: "embedding",
      dimensions: 2,
      async embedTexts(texts) {
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    const result = await managed(new MemgraphClient({ driver: driver.value })).retrieve({
      model,
      query: "checkout",
      search: { type: "vector", seeds: ["entities"], topK: 1 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 2,
        maxNodes: 10,
        maxRelationships: 10,
      },
      evidence: { type: "none" },
    });
    expect(result.seeds[0]?.key).toBe('Incident:{"id":"INC-1"}');
    expect(queries.some((query) => query.includes("vector_search.search("))).toBe(true);
    expect(queries.some((query) => query.includes("*BFS 1..2"))).toBe(true);
  });

  it("scopes write snapshots to the documents being replaced", async () => {
    const driver = fakeDriver(async (query) =>
      query.includes("RETURN collect(c.`__anvia_id`) AS chunkIds")
        ? { records: [record({ chunkIds: [] })] }
        : { records: [] },
    );
    await managed(new MemgraphClient({ driver: driver.value })).replaceDocuments({
      documents: [{ id: "doc-1" }],
      chunks: [],
      entities: [],
      relationships: [],
      mentions: [],
      conflict: "error",
      orphanEntities: "keep",
    });

    const documentSnapshots = driver.run.mock.calls.filter(
      ([query]) =>
        typeof query === "string" &&
        query.includes("MATCH (n:`SupportDocument`)") &&
        query.includes("properties(n) AS properties"),
    );
    expect(documentSnapshots).toHaveLength(2);
    for (const [query, parameters] of documentSnapshots) {
      expect(query).toContain("WHERE n.`__anvia_id` IN $documentIds");
      expect(parameters).toMatchObject({ documentIds: ["doc-1"] });
    }
  });

  it("explores a bounded provider-neutral graph view", async () => {
    const driver = fakeDriver(async (query) => {
      if (query.includes("RETURN id(node) AS id")) {
        return {
          records: [
            record({
              id: 1,
              labels: ["SupportEntity", "Incident"],
              properties: {
                id: "INC-1",
                title: "Checkout unavailable",
                __anvia_key: 'Incident:{"id":"INC-1"}',
                __anvia_embedding: [1, 0],
              },
            }),
            record({
              id: 2,
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
              id: 3,
              type: "AFFECTS",
              source: 1,
              target: 2,
              properties: { severity: "high", __anvia_graph: "support" },
            }),
          ],
        };
      }
      return { records: [] };
    });
    const result = await managed(new MemgraphClient({ driver: driver.value })).explore({
      mode: "overview",
      maxNodes: 10,
      maxRelationships: 10,
    });
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      id: "1",
      type: "Incident",
      identity: { id: "INC-1" },
      properties: { id: "INC-1", title: "Checkout unavailable" },
    });
    expect(result.nodes[0]?.properties).not.toHaveProperty("__anvia_embedding");
    expect(result.relationships[0]).toMatchObject({
      type: "AFFECTS",
      from: "1",
      to: "2",
      properties: { severity: "high" },
    });
  });

  it("validates replacement input before opening a transaction", async () => {
    const driver = fakeDriver();
    await expect(
      managed(new MemgraphClient({ driver: driver.value })).replaceDocuments({
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
    ).rejects.toThrow("2-dimensional");
    expect(driver.session).not.toHaveBeenCalled();
  });
});
