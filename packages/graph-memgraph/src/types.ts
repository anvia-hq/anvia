import type {
  GraphChunk,
  GraphContext,
  GraphDocument,
  GraphEntity,
  GraphEvidence,
  GraphFacts,
  GraphMention,
  GraphNodeIdentity,
  GraphProperties,
  GraphPropertyPrimitive,
  GraphPropertyValue,
  GraphRelationship,
  GraphRetrieveOptions,
  GraphSchema,
  GraphSchemaLike,
  GraphSearchOptions,
  GraphTraversalOptions,
  GraphWriteResult,
} from "@anvia/graph";
import type { EmbeddedDocument } from "@anvia/core/embeddings";
import type { Driver } from "neo4j-driver";

export type MemgraphVectorIndex = Readonly<{
  name: string;
  dimensions: number;
  similarity: "cosine" | "euclidean" | "inner-product";
  capacity?: number | undefined;
  resizeCoefficient?: number | undefined;
  scalarKind?: "f64" | "f32" | "f16" | "bf16" | undefined;
}>;

export type MemgraphTextIndex = Readonly<{
  name: string;
  properties?: readonly string[] | undefined;
}>;

export type ManagedMemgraphKnowledgeGraphOptions<Schema extends GraphSchemaLike> = Readonly<{
  name: string;
  schema: Schema;
  resources: {
    labels: { document: string; chunk: string; entity: string };
    indexes: {
      chunks: { vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined };
      entities: { vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined };
    };
  };
}>;

export type ExistingMemgraphSeed = Readonly<{
  nodeTypes: readonly string[];
  vectorIndex: MemgraphVectorIndex & Readonly<{ property: string }>;
  textIndex?: (MemgraphTextIndex & Readonly<{ properties: readonly string[] }>) | undefined;
}>;

export type MemgraphKnowledgeGraphOptions<Schema extends GraphSchemaLike> = Readonly<{
  schema: Schema;
  seeds: Readonly<Record<string, ExistingMemgraphSeed>>;
}>;

export type MemgraphClientOptions =
  | Readonly<{
      uri: string;
      auth?: { username: string; password: string } | undefined;
      database?: string | undefined;
      driver?: never;
    }>
  | Readonly<{
      driver: Driver;
      database?: string | undefined;
      uri?: never;
      auth?: never;
    }>;

export type MemgraphGraphEnsureOptions = Readonly<{
  abortSignal?: AbortSignal | undefined;
}>;
export type MemgraphGraphValidateOptions = MemgraphGraphEnsureOptions;
export type MemgraphGraphConflict = "error" | "overwrite" | "keep-existing";
export type MemgraphOrphanEntityPolicy = "delete" | "keep";

export type ReplaceMemgraphDocumentsOptions<Schema extends GraphSchemaLike> = Readonly<{
  documents: readonly GraphDocument[];
  chunks: readonly EmbeddedDocument<GraphChunk>[];
  entities: readonly EmbeddedDocument<GraphEntity<Schema>>[];
  relationships: readonly GraphRelationship<Schema>[];
  mentions: readonly GraphMention[];
  conflict: MemgraphGraphConflict;
  orphanEntities: MemgraphOrphanEntityPolicy;
  abortSignal?: AbortSignal | undefined;
}>;

export type DeleteMemgraphDocumentsOptions = Readonly<{
  documentIds: readonly string[];
  orphanEntities: MemgraphOrphanEntityPolicy;
  abortSignal?: AbortSignal | undefined;
}>;

export type RetrieveMemgraphGraphContextOptions<Schema extends GraphSchemaLike> = Readonly<
  GraphRetrieveOptions<Schema> & { graph: MemgraphKnowledgeGraphBaseLike<Schema> }
>;

export interface MemgraphKnowledgeGraphBaseLike<Schema extends GraphSchemaLike> {
  readonly schema: Schema;
  readonly evidenceCapability: "none" | "chunks";
  retrieve(options: GraphRetrieveOptions<Schema>): Promise<GraphContext>;
}

export type {
  GraphChunk as MemgraphGraphChunk,
  GraphContext as MemgraphGraphContext,
  GraphDocument as MemgraphGraphDocument,
  GraphEntity as MemgraphGraphEntity,
  GraphEvidence as MemgraphGraphEvidence,
  GraphFacts as MemgraphGraphFacts,
  GraphMention as MemgraphGraphMention,
  GraphNodeIdentity as MemgraphNodeIdentity,
  GraphProperties as MemgraphProperties,
  GraphPropertyPrimitive as MemgraphPropertyPrimitive,
  GraphPropertyValue as MemgraphPropertyValue,
  GraphRelationship as MemgraphGraphRelationship,
  GraphSchema as MemgraphGraphSchema,
  GraphSearchOptions as MemgraphGraphSearchOptions,
  GraphTraversalOptions as MemgraphGraphTraversalOptions,
};

export type MemgraphGraphWriteResult = GraphWriteResult;
