import { Agent } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { createGraphSearchTool } from "@anvia/graph";
import { defineNeo4jGraphSchema, extractGraphFacts, Neo4jClient } from "@anvia/neo4j";
import { OpenAIClient } from "@anvia/openai";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";
import { z } from "zod";

const schema = defineNeo4jGraphSchema({
  nodes: {
    Product: {
      description: "A product or customer-facing service.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
    Incident: {
      description: "An operational incident.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), title: z.string() }),
    },
  },
  relationships: {
    AFFECTS: {
      description: "An incident affects a product.",
      from: "Incident",
      to: "Product",
      properties: z.strictObject({ severity: z.enum(["low", "medium", "high"]) }),
    },
  },
});

const chunks = [
  {
    id: "incident-42:0",
    documentId: "incident-42",
    index: 0,
    text: "Incident INC-42, Checkout outage, affects product checkout with high severity.",
  },
  {
    id: "incident-51:0",
    documentId: "incident-51",
    index: 0,
    text: "Incident INC-51, Search latency, affects product catalog search with medium severity.",
  },
];

function formatPropertyValue(
  value: string | number | boolean | readonly (string | number | boolean)[],
): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return value.map(formatPropertyValue).join(", ");
}

const openai = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseUrl: process.env.OPENAI_BASEURL,
});
const model = openai.completionModel({ modelId: "gpt-5.5", api: "responses" });
const embeddings = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const client = new Neo4jClient({
  uri: process.env.NEO4J_URI ?? "neo4j://127.0.0.1:7687",
  auth: {
    username: process.env.NEO4J_USERNAME ?? "neo4j",
    password: process.env.NEO4J_PASSWORD ?? "anvia-neo4j",
  },
});
const graph = client.managedKnowledgeGraph({
  name: "cookbook_support",
  schema,
  resources: {
    labels: {
      document: "CookbookSupportDocument",
      chunk: "CookbookSupportChunk",
      entity: "CookbookSupportEntity",
    },
    indexes: {
      chunks: {
        vector: { name: "cookbook_support_chunks", dimensions: 384, similarity: "cosine" },
        fulltext: { name: "cookbook_support_chunks_text" },
      },
      entities: {
        vector: { name: "cookbook_support_entities", dimensions: 384, similarity: "cosine" },
        fulltext: {
          name: "cookbook_support_entities_text",
          properties: ["id", "name", "title"],
        },
      },
    },
  },
});

try {
  await graph.ensure({ indexTimeoutMs: 60_000 });
  const facts = await extractGraphFacts({
    model,
    schema,
    chunks,
    retries: { maxAttempts: 2 },
    concurrency: 2,
  });
  const [embeddedChunks, embeddedEntities] = await Promise.all([
    embedDocuments({
      model: embeddings,
      documents: chunks,
      id: (chunk) => chunk.id,
      content: (chunk) => chunk.text,
    }),
    embedDocuments({
      model: embeddings,
      documents: [...facts.output.entities],
      id: (entity) => entity.key,
      content: (entity) =>
        `${entity.type}: ${Object.entries(entity.properties)
          .map(([name, value]) => `${name}=${formatPropertyValue(value)}`)
          .join("; ")}`,
    }),
  ]);
  const write = await graph.replaceDocuments({
    documents: [{ id: "incident-42" }, { id: "incident-51" }],
    chunks: embeddedChunks.documents,
    entities: embeddedEntities.documents,
    relationships: facts.output.relationships,
    mentions: facts.output.mentions,
    conflict: "overwrite",
    orphanEntities: "delete",
  });
  console.log(write);

  const searchGraph = createGraphSearchTool({
    name: "search_support_graph",
    description: "Search operational incidents and affected products.",
    graph,
    model: embeddings,
    search: {
      type: "hybrid",
      seeds: ["chunks", "entities"],
      topK: 6,
      candidatesPerSeed: 10,
      rrfK: 60,
    },
    traversal: {
      relationships: ["AFFECTS"],
      direction: "both",
      maxDepth: 2,
      maxNodes: 20,
      maxRelationships: 30,
    },
    evidence: { type: "chunks", maxChunks: 8 },
  });
  const agent = new Agent({
    id: "neo4j-support-agent",
    model,
    instructions: "Use the graph tool before answering questions about incidents or products.",
    tools: [searchGraph],
    maxTurns: 3,
  });
  const result = await agent.generate({ prompt: "Which incidents affect checkout?" });
  console.log(result.text);
} finally {
  await embeddings.close();
  await client.close();
}
