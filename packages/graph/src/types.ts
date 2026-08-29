import type { CompletionModel, RetrySetting, Usage } from "@anvia/core";
import type { EmbeddedDocument, EmbeddingModel } from "@anvia/core/embeddings";
import type { Tool } from "@anvia/core/tool";
import type { z } from "zod";

export type GraphPropertyPrimitive = string | number | boolean;
export type GraphPropertyValue =
  | GraphPropertyPrimitive
  | readonly string[]
  | readonly number[]
  | readonly boolean[];
export type GraphProperties = Readonly<Record<string, GraphPropertyValue>>;
export type GraphNodeIdentity = Readonly<Record<string, GraphPropertyPrimitive>>;

export type GraphNodeDefinition = Readonly<{
  description: string;
  identity: readonly string[];
  properties: z.ZodObject<z.ZodRawShape>;
}>;

export type GraphRelationshipDefinition = Readonly<{
  description: string;
  from: string;
  to: string;
  identity?: readonly string[] | undefined;
  properties: z.ZodObject<z.ZodRawShape>;
}>;

export type GraphSchemaOptions = Readonly<{
  nodes: Readonly<Record<string, GraphNodeDefinition>>;
  relationships: Readonly<Record<string, GraphRelationshipDefinition>>;
}>;

export type GraphSchema<Options extends GraphSchemaOptions = GraphSchemaOptions> = Readonly<
  Options & { kind: "graph-schema" }
>;

export type GraphSchemaLike<Options extends GraphSchemaOptions = GraphSchemaOptions> = Readonly<
  Options & { kind: string }
>;

type NodeDefinitions<Schema extends GraphSchemaLike> = Schema["nodes"];
type RelationshipDefinitions<Schema extends GraphSchemaLike> = Schema["relationships"];

export type GraphEntity<Schema extends GraphSchemaLike = GraphSchemaLike> = {
  [Type in keyof NodeDefinitions<Schema> & string]: Readonly<{
    key: string;
    type: Type;
    identity: GraphNodeIdentity;
    properties: z.output<NodeDefinitions<Schema>[Type]["properties"]> & GraphProperties;
    sourceChunkIds: readonly string[];
  }>;
}[keyof NodeDefinitions<Schema> & string];

export type GraphRelationship<Schema extends GraphSchemaLike = GraphSchemaLike> = {
  [Type in keyof RelationshipDefinitions<Schema> & string]: Readonly<{
    key: string;
    type: Type;
    from: string;
    to: string;
    properties: z.output<RelationshipDefinitions<Schema>[Type]["properties"]> & GraphProperties;
    sourceChunkIds: readonly string[];
  }>;
}[keyof RelationshipDefinitions<Schema> & string];

export type GraphMention = Readonly<{ chunkId: string; entityKey: string }>;

export type GraphFacts<Schema extends GraphSchemaLike = GraphSchemaLike> = Readonly<{
  entities: readonly GraphEntity<Schema>[];
  relationships: readonly GraphRelationship<Schema>[];
  mentions: readonly GraphMention[];
}>;

export type GraphFactKind = "entity" | "relationship";

export type GraphFactConflictCandidate = Readonly<{
  chunkId: string;
  properties: GraphProperties;
  value: GraphPropertyValue | undefined;
}>;

export type GraphFactPropertyConflict = Readonly<{
  code: "GRAPH_FACT_CONFLICT";
  kind: GraphFactKind;
  key: string;
  type: string;
  identity: GraphNodeIdentity;
  property: string;
  candidates: readonly GraphFactConflictCandidate[];
  sourceChunkIds: readonly string[];
}>;

export type GraphFactPropertyConflictResolver = (
  conflict: GraphFactPropertyConflict,
) => GraphPropertyValue | undefined;

export type GraphFactPropertyConflictStrategy =
  | "reject"
  | "prefer-first"
  | "prefer-last"
  | "prefer-defined"
  | "prefer-longest"
  | "union"
  | "max"
  | "min"
  | GraphFactPropertyConflictResolver;

export type GraphFactConflictPolicy = Readonly<{
  default?: GraphFactPropertyConflictStrategy | undefined;
  properties?: Readonly<Record<string, GraphFactPropertyConflictStrategy>> | undefined;
  resolve?: GraphFactPropertyConflictResolver | undefined;
}>;

export type GraphFactConflictOptions = Readonly<{
  entity?: GraphFactConflictPolicy | undefined;
  relationship?: GraphFactConflictPolicy | undefined;
}>;

export type GraphFactConflictWarning = Omit<GraphFactPropertyConflict, "code"> &
  Readonly<{
    code: "GRAPH_FACT_CONFLICT_RESOLVED";
    strategy: string;
    resolvedValue: GraphPropertyValue | undefined;
  }>;

export type GraphExtractionWarning = GraphFactConflictWarning;

export type GraphChunk<Metadata extends GraphProperties = GraphProperties> = Readonly<{
  id: string;
  documentId: string;
  index: number;
  text: string;
  metadata?: Metadata | undefined;
}>;

export type GraphDocument<Properties extends GraphProperties = GraphProperties> = Readonly<{
  id: string;
  properties?: Properties | undefined;
}>;

export type ExtractGraphFactsOptions<
  Schema extends GraphSchemaLike,
  Model extends CompletionModel,
> = Readonly<{
  model: Model;
  schema: Schema;
  chunks: readonly GraphChunk[];
  instructions?: string | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  conflicts?: GraphFactConflictOptions | undefined;
}>;

export type ExtractGraphFactsResult<Schema extends GraphSchemaLike> = Readonly<{
  output: GraphFacts<Schema>;
  usage: Usage;
  warnings: readonly GraphExtractionWarning[];
}>;

export type GraphVectorSearchOptions = Readonly<{
  type: "vector";
  seeds: readonly string[];
  topK: number;
  minScore?: number | undefined;
}>;

export type GraphHybridSearchOptions = Readonly<{
  type: "hybrid";
  seeds: readonly string[];
  topK: number;
  candidatesPerSeed: number;
  rrfK: number;
}>;

export type GraphSearchOptions = GraphVectorSearchOptions | GraphHybridSearchOptions;
export type GraphEvidenceOptions =
  | Readonly<{ type: "none" }>
  | Readonly<{ type: "chunks"; maxChunks: number }>;

export type GraphTraversalOptions<Schema extends GraphSchemaLike = GraphSchemaLike> = Readonly<{
  relationships: readonly (keyof Schema["relationships"] & string)[];
  direction: "outgoing" | "incoming" | "both";
  maxDepth: number;
  maxNodes: number;
  maxRelationships: number;
}>;

export type GraphContextSeed = Readonly<{
  key: string;
  type: string;
  score: number;
  properties: GraphProperties;
  sourceChunkIds: readonly string[];
}>;

export type GraphContextNode = Readonly<{
  key: string;
  type: string;
  identity: GraphNodeIdentity;
  properties: GraphProperties;
  sourceChunkIds: readonly string[];
}>;

export type GraphContextRelationship = Readonly<{
  key: string;
  type: string;
  from: string;
  to: string;
  properties: GraphProperties;
  sourceChunkIds: readonly string[];
}>;

export type GraphEvidence = Readonly<{
  chunkId: string;
  documentId: string;
  index: number;
  text: string;
  metadata: GraphProperties;
}>;

export type GraphContext = Readonly<{
  seeds: readonly GraphContextSeed[];
  nodes: readonly GraphContextNode[];
  relationships: readonly GraphContextRelationship[];
  evidence: readonly GraphEvidence[];
}>;

export type GraphEvidenceCapability = "none" | "chunks";

export type GraphEvidenceFor<Capability extends GraphEvidenceCapability> =
  | Extract<GraphEvidenceOptions, { type: "none" }>
  | (Capability extends "chunks" ? Extract<GraphEvidenceOptions, { type: "chunks" }> : never);

export type GraphRetrieveOptions<
  Schema extends GraphSchemaLike,
  Evidence extends GraphEvidenceCapability = GraphEvidenceCapability,
> = Readonly<{
  model: EmbeddingModel;
  query: string;
  search: GraphSearchOptions;
  traversal: GraphTraversalOptions<Schema>;
  evidence: GraphEvidenceFor<Evidence>;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export interface GraphContextRetriever<
  Schema extends GraphSchemaLike = GraphSchemaLike,
  Evidence extends GraphEvidenceCapability = GraphEvidenceCapability,
> {
  readonly evidenceCapability: Evidence;
  retrieve(options: GraphRetrieveOptions<Schema, Evidence>): Promise<GraphContext>;
}

export type GraphExploreDirection = "outgoing" | "incoming" | "both";

export type GraphExploreOverviewOptions<Schema extends GraphSchemaLike> = Readonly<{
  mode: "overview";
  nodeTypes?: readonly (keyof Schema["nodes"] & string)[] | undefined;
  relationships?: readonly (keyof Schema["relationships"] & string)[] | undefined;
  includeProvenance?: boolean | undefined;
  maxNodes?: number | undefined;
  maxRelationships?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type GraphExploreExpandOptions<Schema extends GraphSchemaLike> = Readonly<{
  mode: "expand";
  nodeIds: readonly string[];
  nodeTypes?: readonly (keyof Schema["nodes"] & string)[] | undefined;
  relationships?: readonly (keyof Schema["relationships"] & string)[] | undefined;
  includeProvenance?: boolean | undefined;
  direction?: GraphExploreDirection | undefined;
  maxDepth?: number | undefined;
  maxNodes?: number | undefined;
  maxRelationships?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type GraphExploreOptions<Schema extends GraphSchemaLike> =
  | GraphExploreOverviewOptions<Schema>
  | GraphExploreExpandOptions<Schema>;

export type GraphExploreNode = Readonly<{
  id: string;
  key?: string | undefined;
  type: string;
  identity: GraphNodeIdentity;
  properties: GraphProperties;
  provenance?: GraphExploreProvenance | undefined;
}>;

export type GraphExploreRelationship = Readonly<{
  id: string;
  key?: string | undefined;
  type: string;
  from: string;
  to: string;
  properties: GraphProperties;
  provenance?: GraphExploreProvenance | undefined;
}>;

export type GraphExploreProvenance = Readonly<{
  documentIds: readonly string[];
  chunkIds: readonly string[];
}>;

export type GraphExploreResult = Readonly<{
  nodes: readonly GraphExploreNode[];
  relationships: readonly GraphExploreRelationship[];
  truncated: Readonly<{ nodes: boolean; relationships: boolean }>;
}>;

export interface GraphExplorer<Schema extends GraphSchemaLike = GraphSchemaLike> {
  readonly schema: Schema;
  explore(options: GraphExploreOptions<Schema>): Promise<GraphExploreResult>;
}

export type CreateGraphSearchToolOptions<
  Schema extends GraphSchemaLike,
  Retriever extends GraphContextRetriever<Schema> = GraphContextRetriever<Schema>,
> = Readonly<{
  name: string;
  description: string;
  graph: Retriever;
  model: EmbeddingModel;
  search: GraphSearchOptions;
  traversal: GraphTraversalOptions<Schema>;
  evidence: GraphEvidenceFor<Retriever["evidenceCapability"]>;
  retries?: RetrySetting | undefined;
}>;

export type GraphSearchTool = Tool<{ query: string }, GraphContext>;

export type GraphChangeCounts = Readonly<{
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}>;

export type GraphWriteResult = Readonly<{
  documents: GraphChangeCounts;
  chunks: GraphChangeCounts;
  entities: GraphChangeCounts;
  relationships: GraphChangeCounts;
  mentions: GraphChangeCounts;
}>;

export type GraphWriteConflict = "error" | "overwrite" | "keep-existing";
export type GraphOrphanEntityPolicy = "delete" | "keep";

export type ReplaceGraphDocumentsOptions<Schema extends GraphSchemaLike> = Readonly<{
  documents: readonly GraphDocument[];
  chunks: readonly EmbeddedDocument<GraphChunk>[];
  entities: readonly EmbeddedDocument<GraphEntity<Schema>>[];
  relationships: readonly GraphRelationship<Schema>[];
  mentions: readonly GraphMention[];
  conflict: GraphWriteConflict;
  orphanEntities: GraphOrphanEntityPolicy;
  abortSignal?: AbortSignal | undefined;
}>;

export interface GraphDocumentWriter<Schema extends GraphSchemaLike = GraphSchemaLike> {
  readonly schema: Schema;
  replaceDocuments(options: ReplaceGraphDocumentsOptions<Schema>): Promise<GraphWriteResult>;
}
