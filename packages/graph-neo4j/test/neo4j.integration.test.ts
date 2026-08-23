import type { EmbeddingModel } from "@anvia/core/embeddings";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNeo4jGraphSchema, Neo4jClient, retrieveGraphContext } from "../src/index.js";

const live = process.env.ANVIA_NEO4J_TESTS === "1";

describe.skipIf(!live)("Neo4j integration", () => {
  it("provisions, replaces, and deletes document-scoped graph state", async () => {
    const schema = defineNeo4jGraphSchema({
      nodes: {
        Product: {
          description: "A product.",
          identity: ["id"],
          properties: z.strictObject({
            id: z.string(),
            name: z.string(),
            obsolete: z.string().optional(),
          }),
        },
      },
      relationships: {
        DEPENDS_ON: {
          description: "A product dependency.",
          from: "Product",
          to: "Product",
          properties: z.strictObject({}),
        },
      },
    });
    const client = new Neo4jClient({
      uri: process.env.NEO4J_URI ?? "neo4j://127.0.0.1:7687",
      auth: {
        username: process.env.NEO4J_USERNAME ?? "neo4j",
        password: process.env.NEO4J_PASSWORD ?? "anvia-neo4j",
      },
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
            vector: { name: "anvia_integration_chunks", dimensions: 2, similarity: "cosine" },
            fulltext: { name: "anvia_integration_chunks_text" },
          },
          entities: {
            vector: { name: "anvia_integration_entities", dimensions: 2, similarity: "cosine" },
            fulltext: { name: "anvia_integration_entities_text", properties: ["name"] },
          },
        },
      },
    });
    try {
      await graph.ensure({ indexTimeoutMs: 60_000 });
      const entity = {
        key: 'Product:{"id":"checkout"}',
        type: "Product" as const,
        identity: { id: "checkout" },
        properties: { id: "checkout", name: "Checkout", obsolete: "remove-me" },
        sourceChunkIds: ["integration:0", "shared:0"],
      };
      const relationship = {
        key: `DEPENDS_ON:${entity.key}->${entity.key}:{}`,
        type: "DEPENDS_ON" as const,
        from: entity.key,
        to: entity.key,
        properties: {},
        sourceChunkIds: ["integration:0", "shared:0"],
      };
      const created = await graph.replaceDocuments({
        documents: [{ id: "integration" }, { id: "shared" }],
        chunks: [
          {
            id: "integration:0",
            document: {
              id: "integration:0",
              documentId: "integration",
              index: 0,
              text: "Checkout product.",
              metadata: { url: "https://example.test/integration" },
            },
            embeddings: [{ document: "Checkout product.", vector: [1, 0] }],
          },
          {
            id: "shared:0",
            document: {
              id: "shared:0",
              documentId: "shared",
              index: 0,
              text: "Shared checkout product.",
            },
            embeddings: [{ document: "Shared checkout product.", vector: [1, 0] }],
          },
        ],
        entities: [
          {
            id: entity.key,
            document: entity,
            embeddings: [{ document: "Checkout", vector: [1, 0] }],
          },
        ],
        relationships: [relationship],
        mentions: [
          { chunkId: "integration:0", entityKey: entity.key },
          { chunkId: "shared:0", entityKey: entity.key },
        ],
        conflict: "overwrite",
        orphanEntities: "delete",
      });
      expect(created).toEqual({
        documents: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
        chunks: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
        entities: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        relationships: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
        mentions: { created: 2, updated: 0, deleted: 0, unchanged: 0 },
      });
      const written = await client
        .nativeDriver()
        .executeQuery(
          "MATCH (d:AnviaIntegrationDocument {__anvia_id: $id}) RETURN count(d) AS count",
          { id: "integration" },
        );
      expect(written.records[0]?.get("count").toNumber()).toBe(1);
      const replaced = await graph.replaceDocuments({
        documents: [{ id: "integration" }],
        chunks: [
          {
            id: "integration:0",
            document: {
              id: "integration:0",
              documentId: "integration",
              index: 0,
              text: "Checkout product.",
              metadata: { url: "https://example.test/integration" },
            },
            embeddings: [{ document: "Checkout product.", vector: [1, 0] }],
          },
        ],
        entities: [
          {
            id: entity.key,
            document: {
              ...entity,
              properties: { id: "checkout", name: "Checkout" },
              sourceChunkIds: ["integration:0"],
            },
            embeddings: [{ document: "Checkout", vector: [1, 0] }],
          },
        ],
        relationships: [{ ...relationship, sourceChunkIds: ["integration:0"] }],
        mentions: [{ chunkId: "integration:0", entityKey: entity.key }],
        conflict: "overwrite",
        orphanEntities: "delete",
      });
      expect(replaced).toEqual({
        documents: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        chunks: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        entities: { created: 0, updated: 1, deleted: 0, unchanged: 0 },
        relationships: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
        mentions: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
      });
      const overwritten = await client
        .nativeDriver()
        .executeQuery(
          "MATCH (e:AnviaIntegrationEntity {__anvia_key: $key}) RETURN e.obsolete AS obsolete, e.__anvia_source_document_ids AS documentIds",
          { key: entity.key },
        );
      expect(overwritten.records[0]?.get("obsolete")).toBeNull();
      const documentIds = overwritten.records[0]?.get("documentIds");
      expect(Array.isArray(documentIds)).toBe(true);
      if (!Array.isArray(documentIds)) throw new TypeError("Expected document provenance ids.");
      expect([...documentIds].sort()).toEqual(["integration", "shared"]);
      const embeddingModel: EmbeddingModel = {
        provider: "test",
        modelId: "integration",
        dimensions: 2,
        async embedTexts(texts) {
          return texts.map((document) => ({ document, vector: [1, 0] }));
        },
      };
      const context = await retrieveGraphContext({
        graph,
        model: embeddingModel,
        query: "Checkout",
        search: {
          type: "hybrid",
          seeds: ["chunks", "entities"],
          topK: 2,
          candidatesPerSeed: 4,
          rrfK: 60,
        },
        traversal: {
          relationships: ["DEPENDS_ON"],
          direction: "both",
          maxDepth: 1,
          maxNodes: 10,
          maxRelationships: 10,
        },
        evidence: { type: "chunks", maxChunks: 4 },
      });
      expect(context.seeds[0]).toMatchObject({
        key: "integration:0",
        sourceChunkIds: ["integration:0"],
      });
      expect(context.evidence[0]).toMatchObject({
        chunkId: "integration:0",
        documentId: "integration",
        text: "Checkout product.",
        metadata: { url: "https://example.test/integration" },
      });
      expect(context.nodes[0]).toMatchObject({ key: entity.key, type: "Product" });
      const deletedIntegration = await graph.deleteDocuments({
        documentIds: ["integration"],
        orphanEntities: "delete",
      });
      expect(deletedIntegration).toEqual({
        documents: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        chunks: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        entities: { created: 0, updated: 1, deleted: 0, unchanged: 0 },
        relationships: { created: 0, updated: 1, deleted: 0, unchanged: 0 },
        mentions: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
      });
      const deleted = await client
        .nativeDriver()
        .executeQuery(
          "MATCH (d:AnviaIntegrationDocument {__anvia_id: $id}) RETURN count(d) AS count",
          { id: "integration" },
        );
      expect(deleted.records[0]?.get("count").toNumber()).toBe(0);
      const deletedShared = await graph.deleteDocuments({
        documentIds: ["shared"],
        orphanEntities: "delete",
      });
      expect(deletedShared).toEqual({
        documents: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        chunks: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        entities: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        relationships: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
        mentions: { created: 0, updated: 0, deleted: 1, unchanged: 0 },
      });
    } finally {
      await client.close();
    }
  }, 90_000);
});
