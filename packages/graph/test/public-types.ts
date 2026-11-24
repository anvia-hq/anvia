import type { EmbeddingModel } from "@anvia/core/embeddings";
import { z } from "zod";
import {
  createGraphContext,
  createGraphSearchTool,
  createKnowledgeGraph,
  defineGraphSchema,
  formatGraphContext,
  ingestGraphText,
  ingestGraphTextToStores,
  type GraphContextRetriever,
  type GraphDocumentWriter,
  type GraphSchemaLike,
} from "../src/index.js";

const typedSchema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product.",
      identity: ["id"],
      properties: z.object({ id: z.string(), name: z.string() }),
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

const nodeOnlySchema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product.",
      identity: ["id"],
      properties: z.object({ id: z.string() }),
    },
  },
});

defineGraphSchema({
  nodes: {
    Product: {
      description: "A product.",
      // @ts-expect-error Identity keys must exist in node properties.
      identity: ["missing"],
      properties: z.object({ id: z.string() }),
    },
  },
});

defineGraphSchema({
  nodes: {
    Product: {
      description: "A product.",
      identity: ["id"],
      properties: z.object({ id: z.string() }),
    },
  },
  relationships: {
    BAD: {
      description: "Bad endpoint.",
      // @ts-expect-error Relationship endpoint must name a declared node.
      from: "Unknown",
      to: "Product",
    },
  },
});

void [typedSchema, nodeOnlySchema];

declare const model: EmbeddingModel;
declare const existing: GraphContextRetriever<GraphSchemaLike, "none">;
declare const managed: GraphContextRetriever<GraphSchemaLike, "chunks">;
declare const writer: GraphDocumentWriter<GraphSchemaLike>;
declare const vectorStore: { upsert(options: { documents: unknown[] }): Promise<void> };

createGraphSearchTool({
  name: "search_graph",
  graph: managed,
  model,
});

createGraphSearchTool({
  name: "search_graph_text",
  graph: managed,
  model,
  format: formatGraphContext,
});

createGraphContext({
  graph: managed,
  model,
});

createKnowledgeGraph({
  graph: managed,
  embeddingModel: model,
});

createGraphSearchTool({
  name: "search_graph",
  graph: existing,
  model,
  evidence: { type: "none" },
});

ingestGraphText({
  graph: writer,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
});

ingestGraphText({
  graph: writer,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
  factConflicts: {
    entity: {
      properties: { summary: "prefer-longest", aliases: "union", confidence: "max" },
    },
  },
  conflict: "error",
  orphanEntities: "delete",
});

ingestGraphTextToStores({
  graph: writer,
  vectorStore,
  document: { id: "one", text: "Product One" },
  revision: "revision-2",
  extractionModel: {} as never,
  embeddingModel: model,
  conflict: "overwrite",
  orphanEntities: "delete",
});

ingestGraphText({
  // @ts-expect-error Read-only graph registrations do not implement document writes.
  graph: existing,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
});

createGraphSearchTool({
  name: "search_graph",
  graph: managed,
  model,
  evidence: { type: "chunks", maxChunks: 2 },
});

createGraphSearchTool({
  name: "search_graph",
  graph: managed,
  model,
  evidence: { type: "none" },
});

createGraphSearchTool({
  name: "search_graph",
  graph: existing,
  model,
  // @ts-expect-error Existing graph registrations cannot hydrate managed chunk evidence.
  evidence: { type: "chunks", maxChunks: 2 },
});
