import type { EmbeddingModel } from "@anvia/core/embeddings";
import { defineGraphSchema } from "@anvia/graph";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemgraphClient } from "../src/index.js";

const enabled = process.env.ANVIA_MEMGRAPH_DOCKER_TESTS === "1";

describe.skipIf(!enabled)("Memgraph integration", () => {
  it("provisions, writes, retrieves, and deletes a managed knowledge graph", async () => {
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
    await using client = new MemgraphClient({
      uri: process.env.MEMGRAPH_URI ?? "bolt://localhost:17687",
    });
    const graph = client.managedKnowledgeGraph({
      name: "integration",
      schema,
      resources: {
        labels: {
          document: "AnviaIntegrationDocument",
          chunk: "AnviaIntegrationChunk",
          entity: "AnviaIntegrationEntity",
        },
        indexes: {
          chunks: {
            vector: {
              name: "anvia_integration_chunks_vector",
              dimensions: 2,
              similarity: "cosine",
              capacity: 100,
            },
            text: { name: "anvia_integration_chunks_text" },
          },
          entities: {
            vector: {
              name: "anvia_integration_entities_vector",
              dimensions: 2,
              similarity: "cosine",
              capacity: 100,
            },
            text: {
              name: "anvia_integration_entities_text",
              properties: ["name", "title"],
            },
          },
        },
      },
    });
    await graph.ensure();
    await graph.deleteDocuments({ documentIds: ["doc-1"], orphanEntities: "delete" });
    const incident = 'Incident:{"id":"INC-1"}';
    const product = 'Product:{"id":"checkout"}';
    const write = await graph.replaceDocuments({
      documents: [{ id: "doc-1", properties: { source: "integration" } }],
      chunks: [
        {
          id: "chunk-1",
          document: {
            id: "chunk-1",
            documentId: "doc-1",
            index: 0,
            text: "Checkout is affected by incident INC-1.",
          },
          embeddings: [{ document: "Checkout is affected by incident INC-1.", vector: [1, 0] }],
        },
      ],
      entities: [
        {
          id: incident,
          document: {
            key: incident,
            type: "Incident",
            identity: { id: "INC-1" },
            properties: { id: "INC-1", title: "Checkout unavailable" },
            sourceChunkIds: ["chunk-1"],
          },
          embeddings: [{ document: "Checkout unavailable", vector: [1, 0] }],
        },
        {
          id: product,
          document: {
            key: product,
            type: "Product",
            identity: { id: "checkout" },
            properties: { id: "checkout", name: "Checkout" },
            sourceChunkIds: ["chunk-1"],
          },
          embeddings: [{ document: "Checkout", vector: [0.9, 0.1] }],
        },
      ],
      relationships: [
        {
          key: `AFFECTS:${incident}->${product}:{}`,
          type: "AFFECTS",
          from: incident,
          to: product,
          properties: { severity: "high" },
          sourceChunkIds: ["chunk-1"],
        },
      ],
      mentions: [
        { chunkId: "chunk-1", entityKey: incident },
        { chunkId: "chunk-1", entityKey: product },
      ],
      conflict: "error",
      orphanEntities: "delete",
    });
    expect(write.documents.created).toBe(1);
    expect(write.entities.created).toBe(2);

    const model: EmbeddingModel = {
      provider: "integration",
      modelId: "fixed",
      dimensions: 2,
      async embedTexts(texts) {
        return texts.map((document) => ({ document, vector: [1, 0] }));
      },
    };
    const context = await graph.retrieve({
      model,
      query: "checkout incident",
      search: { type: "vector", seeds: ["entities"], topK: 2 },
      traversal: {
        relationships: ["AFFECTS"],
        direction: "both",
        maxDepth: 1,
        maxNodes: 10,
        maxRelationships: 10,
      },
      evidence: { type: "chunks", maxChunks: 1 },
    });
    expect(context.seeds.length).toBeGreaterThan(0);
    expect(context.evidence[0]?.chunkId).toBe("chunk-1");

    const deleted = await graph.deleteDocuments({
      documentIds: ["doc-1"],
      orphanEntities: "delete",
    });
    expect(deleted.documents.deleted).toBe(1);
    expect(deleted.entities.deleted).toBe(2);
  }, 30_000);
});
