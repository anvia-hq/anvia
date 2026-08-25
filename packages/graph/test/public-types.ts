import type { EmbeddingModel } from "@anvia/core/embeddings";
import {
  createGraphSearchTool,
  ingestGraphText,
  type GraphContextRetriever,
  type GraphDocumentWriter,
  type GraphSchemaLike,
} from "../src/index.js";

declare const model: EmbeddingModel;
declare const existing: GraphContextRetriever<GraphSchemaLike, "none">;
declare const managed: GraphContextRetriever<GraphSchemaLike, "chunks">;
declare const writer: GraphDocumentWriter<GraphSchemaLike>;

const retrieval = {
  name: "search_graph",
  description: "Search the graph.",
  model,
  search: { type: "vector" as const, seeds: ["entities"], topK: 2 },
  traversal: {
    relationships: [],
    direction: "both" as const,
    maxDepth: 1,
    maxNodes: 2,
    maxRelationships: 2,
  },
};

createGraphSearchTool({
  ...retrieval,
  graph: existing,
  evidence: { type: "none" },
});

ingestGraphText({
  graph: writer,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
  conflict: "error",
  orphanEntities: "delete",
});

ingestGraphText({
  // @ts-expect-error Read-only graph registrations do not implement document writes.
  graph: existing,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
  conflict: "error",
  orphanEntities: "delete",
});

// @ts-expect-error Graph ingestion requires explicit conflict and orphan policies.
ingestGraphText({
  graph: writer,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
});

createGraphSearchTool({
  ...retrieval,
  graph: managed,
  evidence: { type: "chunks", maxChunks: 2 },
});

createGraphSearchTool({
  ...retrieval,
  graph: managed,
  evidence: { type: "none" },
});

createGraphSearchTool({
  ...retrieval,
  graph: existing,
  // @ts-expect-error Existing graph registrations cannot hydrate managed chunk evidence.
  evidence: { type: "chunks", maxChunks: 2 },
});
