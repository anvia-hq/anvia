import type { EmbeddingModel } from "@anvia/core/embeddings";
import { ingestGraphText } from "@anvia/graph";
import type {
  ManagedMemgraphKnowledgeGraph,
  MemgraphGraphSchema,
  MemgraphKnowledgeGraph,
} from "../src/index.js";

declare const model: EmbeddingModel;
declare const managed: ManagedMemgraphKnowledgeGraph<MemgraphGraphSchema>;
declare const existing: MemgraphKnowledgeGraph<MemgraphGraphSchema>;

ingestGraphText({
  graph: managed,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
  conflict: "error",
  orphanEntities: "delete",
});

ingestGraphText({
  // @ts-expect-error Existing Memgraph registrations are read-only ingestion targets.
  graph: existing,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
  conflict: "error",
  orphanEntities: "delete",
});
