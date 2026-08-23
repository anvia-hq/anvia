import type { EmbeddingModel } from "@anvia/core/embeddings";
import type {
  CreateNeo4jGraphSearchToolOptions,
  ManagedNeo4jKnowledgeGraph,
  Neo4jGraphSchema,
  Neo4jKnowledgeGraph,
  Neo4jPropertyValue,
  RetrieveGraphContextOptions,
} from "../src/index.js";

const strings: Neo4jPropertyValue = ["one", "two"];
const numbers: Neo4jPropertyValue = [1, 2];
const booleans: Neo4jPropertyValue = [true, false];

// @ts-expect-error Neo4j property arrays must be homogeneous.
const mixed: Neo4jPropertyValue = ["one", 2];

void [strings, numbers, booleans, mixed];

declare const model: EmbeddingModel;
declare const existing: Neo4jKnowledgeGraph<Neo4jGraphSchema>;
declare const managed: ManagedNeo4jKnowledgeGraph<Neo4jGraphSchema>;
declare const forged: {
  readonly schema: Neo4jGraphSchema;
  readonly evidenceCapability: "chunks";
  validate(): Promise<void>;
};

const retrieval = {
  model,
  query: "query",
  search: { type: "vector" as const, seeds: ["entities"], topK: 2 },
  traversal: {
    relationships: [],
    direction: "both" as const,
    maxDepth: 1,
    maxNodes: 2,
    maxRelationships: 2,
  },
};

const managedEvidence: RetrieveGraphContextOptions<Neo4jGraphSchema> = {
  ...retrieval,
  graph: managed,
  evidence: { type: "chunks", maxChunks: 2 },
};

const forgedEvidence: RetrieveGraphContextOptions<Neo4jGraphSchema> = {
  ...retrieval,
  // @ts-expect-error Retrieval accepts only registrations created by Neo4jClient.
  graph: forged,
  evidence: { type: "chunks", maxChunks: 2 },
};

// @ts-expect-error Existing graph registrations cannot hydrate managed chunk evidence.
const existingEvidence: RetrieveGraphContextOptions<Neo4jGraphSchema> = {
  ...retrieval,
  graph: existing,
  evidence: { type: "chunks", maxChunks: 2 },
};

// @ts-expect-error Retrieval always requires an explicit evidence mode.
const missingEvidence: RetrieveGraphContextOptions<Neo4jGraphSchema> = {
  ...retrieval,
  graph: managed,
};

// @ts-expect-error Tool registration also requires an explicit evidence mode.
const toolWithoutEvidence: CreateNeo4jGraphSearchToolOptions<Neo4jGraphSchema> = {
  ...retrieval,
  name: "search_graph",
  description: "Search the graph.",
  graph: managed,
};

// @ts-expect-error Existing graph tools cannot hydrate managed chunk evidence.
const existingToolEvidence: CreateNeo4jGraphSearchToolOptions<Neo4jGraphSchema> = {
  ...retrieval,
  name: "search_graph",
  description: "Search the graph.",
  graph: existing,
  evidence: { type: "chunks", maxChunks: 2 },
};

void [
  managedEvidence,
  forgedEvidence,
  existingEvidence,
  missingEvidence,
  toolWithoutEvidence,
  existingToolEvidence,
];
