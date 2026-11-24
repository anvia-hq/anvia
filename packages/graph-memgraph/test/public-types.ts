import type { EmbeddingModel } from "@anvia/core/embeddings";
import { ingestGraphText } from "@anvia/graph";
import type {
  ManagedMemgraphKnowledgeGraph,
  MemgraphClient,
  MemgraphGraphSchema,
  MemgraphKnowledgeGraph,
} from "../src/index.js";

declare const client: MemgraphClient;
declare const model: EmbeddingModel;
declare const managed: ManagedMemgraphKnowledgeGraph<MemgraphGraphSchema>;
declare const existing: MemgraphKnowledgeGraph<MemgraphGraphSchema>;

const shorthand = client.managedKnowledgeGraph({
  name: "support",
  schema: {} as MemgraphGraphSchema,
  dimensions: 1536,
  similarity: "dotProduct",
  fulltext: true,
});

void [shorthand, managed.retrieve({ model, query: "checkout" })];

ingestGraphText({
  graph: managed,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
});

ingestGraphText({
  // @ts-expect-error Existing Memgraph registrations are read-only ingestion targets.
  graph: existing,
  document: { id: "one", text: "Product One" },
  extractionModel: {} as never,
  embeddingModel: model,
});
