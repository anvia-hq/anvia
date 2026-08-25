import type { EmbeddingModel } from "@anvia/core/embeddings";
import {
  createGraphSearchTool,
  type GraphContextRetriever,
  type GraphSchemaLike,
} from "../src/index.js";

declare const model: EmbeddingModel;
declare const existing: GraphContextRetriever<GraphSchemaLike, "none">;
declare const managed: GraphContextRetriever<GraphSchemaLike, "chunks">;

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
