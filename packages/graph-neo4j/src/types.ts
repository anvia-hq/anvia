import type { CompletionModel, RetrySetting, Usage } from "@anvia/core";
import type { EmbeddedDocument } from "@anvia/core/embeddings";
import type { Driver } from "neo4j-driver";
import type { z } from "zod";
import type { ManagedNeo4jKnowledgeGraph, Neo4jKnowledgeGraph } from "./graph.js";

export type Neo4jPropertyPrimitive = string | number | boolean;
export type Neo4jPropertyValue =
  | Neo4jPropertyPrimitive
  | readonly string[]
  | readonly number[]
  | readonly boolean[];
export type Neo4jProperties = Readonly<Record<string, Neo4jPropertyValue>>;
export type Neo4jNodeIdentity = Readonly<Record<string, Neo4jPropertyPrimitive>>;

export type Neo4jNodeDefinition = Readonly<{
  description: string;
  identity: readonly string[];
  properties: z.ZodObject<z.ZodRawShape>;
}>;

export type Neo4jRelationshipDefinition = Readonly<{
  description: string;
  from: string;
  to: string;
  identity?: readonly string[] | undefined;
  properties: z.ZodObject<z.ZodRawShape>;
}>;

export type Neo4jGraphSchemaOptions = Readonly<{
  nodes: Readonly<Record<string, Neo4jNodeDefinition>>;
  relationships: Readonly<Record<string, Neo4jRelationshipDefinition>>;
}>;

export type Neo4jGraphSchema<Options extends Neo4jGraphSchemaOptions = Neo4jGraphSchemaOptions> =
  Readonly<Options & { kind: "neo4j-graph-schema" | "graph-schema" }>;

type NodeDefinitions<Schema extends Neo4jGraphSchema> = Schema["nodes"];
type RelationshipDefinitions<Schema extends Neo4jGraphSchema> = Schema["relationships"];

export type Neo4jGraphEntity<Schema extends Neo4jGraphSchema = Neo4jGraphSchema> = {
  [Type in keyof NodeDefinitions<Schema> & string]: Readonly<{
    key: string;
    type: Type;
    identity: Neo4jNodeIdentity;
    properties: z.output<NodeDefinitions<Schema>[Type]["properties"]> & Neo4jProperties;
    sourceChunkIds: readonly string[];
  }>;
}[keyof NodeDefinitions<Schema> & string];

export type Neo4jGraphRelationship<Schema extends Neo4jGraphSchema = Neo4jGraphSchema> = {
  [Type in keyof RelationshipDefinitions<Schema> & string]: Readonly<{
    key: string;
    type: Type;
    from: string;
    to: string;
    properties: z.output<RelationshipDefinitions<Schema>[Type]["properties"]> & Neo4jProperties;
    sourceChunkIds: readonly string[];
  }>;
}[keyof RelationshipDefinitions<Schema> & string];

export type Neo4jGraphMention = Readonly<{
  chunkId: string;
  entityKey: string;
}>;

export type Neo4jGraphFacts<Schema extends Neo4jGraphSchema = Neo4jGraphSchema> = Readonly<{
  entities: readonly Neo4jGraphEntity<Schema>[];
  relationships: readonly Neo4jGraphRelationship<Schema>[];
  mentions: readonly Neo4jGraphMention[];
}>;

export type Neo4jGraphChunk<Metadata extends Neo4jProperties = Neo4jProperties> = Readonly<{
  id: string;
  documentId: string;
  index: number;
  text: string;
  metadata?: Metadata | undefined;
}>;

export type Neo4jGraphDocument<Properties extends Neo4jProperties = Neo4jProperties> = Readonly<{
  id: string;
  properties?: Properties | undefined;
}>;

export type ExtractGraphFactsOptions<
  Schema extends Neo4jGraphSchema,
  Model extends CompletionModel,
> = Readonly<{
  model: Model;
  schema: Schema;
  chunks: readonly Neo4jGraphChunk[];
  instructions?: string | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type ExtractGraphFactsResult<Schema extends Neo4jGraphSchema> = Readonly<{
  output: Neo4jGraphFacts<Schema>;
  usage: Usage;
}>;

export type Neo4jVectorIndex = Readonly<{
  name: string;
  dimensions: number;
  similarity: "cosine" | "euclidean";
}>;

export type Neo4jFulltextIndex = Readonly<{
  name: string;
  properties?: readonly string[] | undefined;
}>;

export type ManagedNeo4jKnowledgeGraphOptions<Schema extends Neo4jGraphSchema> = Readonly<{
  name: string;
  schema: Schema;
  resources: {
    labels: { document: string; chunk: string; entity: string };
    indexes: {
      chunks: { vector: Neo4jVectorIndex; fulltext?: Neo4jFulltextIndex | undefined };
      entities: { vector: Neo4jVectorIndex; fulltext?: Neo4jFulltextIndex | undefined };
    };
  };
}>;

export type ExistingNeo4jSeed = Readonly<{
  nodeTypes: readonly string[];
  vectorIndex: Neo4jVectorIndex & Readonly<{ property: string }>;
  fulltextIndex?: (Neo4jFulltextIndex & Readonly<{ properties: readonly string[] }>) | undefined;
}>;

export type Neo4jKnowledgeGraphOptions<Schema extends Neo4jGraphSchema> = Readonly<{
  schema: Schema;
  seeds: Readonly<Record<string, ExistingNeo4jSeed>>;
}>;

export type Neo4jClientOptions =
  | Readonly<{
      uri: string;
      auth: { username: string; password: string };
      database?: string | undefined;
      driver?: never;
    }>
  | Readonly<{
      driver: Driver;
      database?: string | undefined;
      uri?: never;
      auth?: never;
    }>;

export type Neo4jGraphValidateOptions = Readonly<{ abortSignal?: AbortSignal | undefined }>;
export type Neo4jGraphEnsureOptions = Readonly<{
  indexTimeoutMs: number;
  abortSignal?: AbortSignal | undefined;
}>;

export type Neo4jGraphConflict = "error" | "overwrite" | "keep-existing";
export type Neo4jOrphanEntityPolicy = "delete" | "keep";

export type ReplaceNeo4jDocumentsOptions<Schema extends Neo4jGraphSchema> = Readonly<{
  documents: readonly Neo4jGraphDocument[];
  chunks: readonly EmbeddedDocument<Neo4jGraphChunk>[];
  entities: readonly EmbeddedDocument<Neo4jGraphEntity<Schema>>[];
  relationships: readonly Neo4jGraphRelationship<Schema>[];
  mentions: readonly Neo4jGraphMention[];
  conflict: Neo4jGraphConflict;
  orphanEntities: Neo4jOrphanEntityPolicy;
  abortSignal?: AbortSignal | undefined;
}>;

export type DeleteNeo4jDocumentsOptions = Readonly<{
  documentIds: readonly string[];
  orphanEntities: Neo4jOrphanEntityPolicy;
  abortSignal?: AbortSignal | undefined;
}>;

export type Neo4jVectorSearchOptions = Readonly<{
  type: "vector";
  seeds: readonly string[];
  topK: number;
  minScore?: number | undefined;
}>;

export type Neo4jHybridSearchOptions = Readonly<{
  type: "hybrid";
  seeds: readonly string[];
  topK: number;
  candidatesPerSeed: number;
  rrfK: number;
}>;

export type Neo4jGraphSearchOptions = Neo4jVectorSearchOptions | Neo4jHybridSearchOptions;

export type Neo4jGraphEvidenceOptions =
  | Readonly<{ type: "none" }>
  | Readonly<{
      type: "chunks";
      maxChunks: number;
    }>;

export type Neo4jGraphEvidence = Readonly<{
  chunkId: string;
  documentId: string;
  index: number;
  text: string;
  metadata: Neo4jProperties;
}>;

export type Neo4jGraphTraversalOptions<Schema extends Neo4jGraphSchema = Neo4jGraphSchema> =
  Readonly<{
    relationships: readonly (keyof Schema["relationships"] & string)[];
    direction: "outgoing" | "incoming" | "both";
    maxDepth: number;
    maxNodes: number;
    maxRelationships: number;
  }>;

export type Neo4jGraphContextSeed = Readonly<{
  key: string;
  type: string;
  score: number;
  properties: Neo4jProperties;
  sourceChunkIds: readonly string[];
}>;

export type Neo4jGraphContextNode = Readonly<{
  key: string;
  type: string;
  identity: Neo4jNodeIdentity;
  properties: Neo4jProperties;
  sourceChunkIds: readonly string[];
}>;

export type Neo4jGraphContextRelationship = Readonly<{
  key: string;
  type: string;
  from: string;
  to: string;
  properties: Neo4jProperties;
  sourceChunkIds: readonly string[];
}>;

export type Neo4jGraphContext = Readonly<{
  seeds: readonly Neo4jGraphContextSeed[];
  nodes: readonly Neo4jGraphContextNode[];
  relationships: readonly Neo4jGraphContextRelationship[];
  evidence: readonly Neo4jGraphEvidence[];
}>;

export type Neo4jGraphEvidenceCapability = "none" | "chunks";

type AnyNeo4jKnowledgeGraph<Schema extends Neo4jGraphSchema> =
  | Neo4jKnowledgeGraph<Schema>
  | ManagedNeo4jKnowledgeGraph<Schema>;

type RetrieveGraphContextBase<Schema extends Neo4jGraphSchema> = Readonly<{
  model: import("@anvia/core/embeddings").EmbeddingModel;
  query: string;
  search: Neo4jGraphSearchOptions;
  traversal: Neo4jGraphTraversalOptions<Schema>;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type RetrieveGraphContextOptions<Schema extends Neo4jGraphSchema> =
  | (RetrieveGraphContextBase<Schema> &
      Readonly<{
        graph: AnyNeo4jKnowledgeGraph<Schema>;
        evidence: Readonly<{ type: "none" }>;
      }>)
  | (RetrieveGraphContextBase<Schema> &
      Readonly<{
        graph: ManagedNeo4jKnowledgeGraph<Schema>;
        evidence: Readonly<{ type: "chunks"; maxChunks: number }>;
      }>);

export type Neo4jGraphChangeCounts = Readonly<{
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}>;

export type Neo4jGraphWriteResult = Readonly<{
  documents: Neo4jGraphChangeCounts;
  chunks: Neo4jGraphChangeCounts;
  entities: Neo4jGraphChangeCounts;
  relationships: Neo4jGraphChangeCounts;
  mentions: Neo4jGraphChangeCounts;
}>;
