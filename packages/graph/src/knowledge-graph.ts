import { createHash } from "node:crypto";
import type {
  CompletionModel,
  ContextSource,
  Document,
  JsonObject,
  RetrySetting,
} from "@anvia/core";
import type {
  TextDocument,
  TextDocumentChunkingOptions,
  TextDocumentMetadata,
} from "@anvia/core/documents";
import type { EmbeddingModel } from "@anvia/core/embeddings";
import { createGraphContext } from "./context.js";
import {
  ingestGraphDocuments,
  ingestGraphDocumentsToStores,
  type GraphIngestionProgressEvent,
  type GraphVectorWriter,
  type IngestGraphDocumentsResult,
} from "./ingest.js";
import { createGraphSearchTool } from "./tool.js";
import type {
  GraphContext,
  GraphContextRetriever,
  GraphDocumentWriter,
  GraphEntity,
  GraphEvidenceInputFor,
  GraphExploreOptions,
  GraphExploreResult,
  GraphExplorer,
  GraphFactConflictOptions,
  GraphInvalidFactPolicy,
  GraphOrphanEntityPolicy,
  GraphSchemaLike,
  GraphSearchInput,
  GraphSearchTool,
  GraphTraversalInput,
  GraphWriteConflict,
} from "./types.js";

export type KnowledgeGraphDocumentInput =
  | string
  | Readonly<{
      id?: string | undefined;
      text: string;
      metadata?: TextDocumentMetadata | undefined;
    }>;

export type KnowledgeGraphIngestInput =
  | KnowledgeGraphDocumentInput
  | readonly KnowledgeGraphDocumentInput[];

export type CreateKnowledgeGraphOptions<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema> = GraphContextRetriever<Schema>,
  ExtractionModel extends CompletionModel = CompletionModel,
> = Readonly<{
  graph: Graph;
  embeddingModel: EmbeddingModel;
  extractionModel?: ExtractionModel | undefined;
  vectorStore?: GraphVectorWriter | undefined;
  chunking?: TextDocumentChunkingOptions | undefined;
  entityText?: ((entity: GraphEntity<Schema>) => string) | undefined;
  maxEntityTextLength?: number | undefined;
  instructions?: string | undefined;
  conflict?: GraphWriteConflict | undefined;
  orphanEntities?: GraphOrphanEntityPolicy | undefined;
  factConflicts?: GraphFactConflictOptions | undefined;
  onInvalidFact?: GraphInvalidFactPolicy | undefined;
  onProgress?: ((event: GraphIngestionProgressEvent) => void) | undefined;
  search?: GraphSearchInput | undefined;
  traversal?: GraphTraversalInput<Schema> | undefined;
  evidence?: GraphEvidenceInputFor<Graph["evidenceCapability"]> | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
}>;

export type KnowledgeGraphIngestOptions<Schema extends GraphSchemaLike> = Readonly<{
  extractionModel?: CompletionModel | undefined;
  chunking?: TextDocumentChunkingOptions | undefined;
  entityText?: ((entity: GraphEntity<Schema>) => string) | undefined;
  maxEntityTextLength?: number | undefined;
  instructions?: string | undefined;
  conflict?: GraphWriteConflict | undefined;
  orphanEntities?: GraphOrphanEntityPolicy | undefined;
  factConflicts?: GraphFactConflictOptions | undefined;
  onInvalidFact?: GraphInvalidFactPolicy | undefined;
  onProgress?: ((event: GraphIngestionProgressEvent) => void) | undefined;
  revision?: string | undefined;
  vectorStore?: GraphVectorWriter | undefined;
  vectorProviderOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type KnowledgeGraphRetrieveOptions<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema>,
> = Readonly<{
  search?: GraphSearchInput | undefined;
  traversal?: GraphTraversalInput<Schema> | undefined;
  evidence?: GraphEvidenceInputFor<Graph["evidenceCapability"]> | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type KnowledgeGraphToolOptions<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema>,
  Formatted = GraphContext,
> = Readonly<{
  name: string;
  description?: string | undefined;
  search?: GraphSearchInput | undefined;
  traversal?: GraphTraversalInput<Schema> | undefined;
  evidence?: GraphEvidenceInputFor<Graph["evidenceCapability"]> | undefined;
  retries?: RetrySetting | undefined;
  format?: ((context: GraphContext) => Formatted) | undefined;
}>;

export type KnowledgeGraphContextOptions<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema>,
> = Readonly<{
  id?: string | undefined;
  search?: GraphSearchInput | undefined;
  traversal?: GraphTraversalInput<Schema> | undefined;
  evidence?: GraphEvidenceInputFor<Graph["evidenceCapability"]> | undefined;
  retries?: RetrySetting | undefined;
  format?: ((context: GraphContext) => readonly Document[]) | undefined;
}>;

export interface KnowledgeGraphHandle<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema> = GraphContextRetriever<Schema>,
> {
  readonly graph: Graph;
  /**
   * Ingest one or more documents into the knowledge graph.
   *
   * Plain-string inputs and objects without an explicit `id` derive a deterministic
   * content-hash document id. Re-ingesting edited text without an explicit `id` creates
   * a new document rather than replacing the previous one; pass `{ id, text }` whenever
   * you want in-place document replacement.
   */
  ingest(
    input: KnowledgeGraphIngestInput,
    options?: KnowledgeGraphIngestOptions<Schema>,
  ): Promise<IngestGraphDocumentsResult<Schema>>;
  retrieve(
    query: string,
    options?: KnowledgeGraphRetrieveOptions<Schema, Graph>,
  ): Promise<GraphContext>;
  asTool(
    options: Omit<KnowledgeGraphToolOptions<Schema, Graph, GraphContext>, "format"> & {
      format?: undefined;
    },
  ): GraphSearchTool<GraphContext>;
  asTool<Formatted>(
    options: Omit<KnowledgeGraphToolOptions<Schema, Graph, Formatted>, "format"> & {
      format: (context: GraphContext) => Formatted;
    },
  ): GraphSearchTool<Formatted>;
  asContext(options?: KnowledgeGraphContextOptions<Schema, Graph>): ContextSource;
  explore(options: GraphExploreOptions<Schema>): Promise<GraphExploreResult>;
}

export function createKnowledgeGraph<
  Schema extends GraphSchemaLike,
  Graph extends GraphContextRetriever<Schema>,
  ExtractionModel extends CompletionModel = CompletionModel,
>(
  options: CreateKnowledgeGraphOptions<Schema, Graph, ExtractionModel>,
): KnowledgeGraphHandle<Schema, Graph> {
  const handle: KnowledgeGraphHandle<Schema, Graph> = {
    graph: options.graph,
    ingest: async (input, ingestOptions = {}) => {
      if (!isDocumentWriter<Schema>(options.graph)) {
        throw new TypeError(
          "The configured graph registration is read-only and cannot ingest documents.",
        );
      }

      const extractionModel = ingestOptions.extractionModel ?? options.extractionModel;

      if (extractionModel === undefined) {
        throw new TypeError("Knowledge graph ingestion requires an extractionModel.");
      }

      const documents = normalizeDocuments(input);
      const vectorStore = ingestOptions.vectorStore ?? options.vectorStore;
      const shared = {
        graph: options.graph,
        documents,
        extractionModel,
        embeddingModel: options.embeddingModel,
        chunking: ingestOptions.chunking ?? options.chunking,
        entityText: ingestOptions.entityText ?? options.entityText,
        maxEntityTextLength: ingestOptions.maxEntityTextLength ?? options.maxEntityTextLength,
        instructions: ingestOptions.instructions ?? options.instructions,
        conflict: ingestOptions.conflict ?? options.conflict,
        orphanEntities: ingestOptions.orphanEntities ?? options.orphanEntities,
        factConflicts: ingestOptions.factConflicts ?? options.factConflicts,
        onInvalidFact: ingestOptions.onInvalidFact ?? options.onInvalidFact,
        onProgress: ingestOptions.onProgress ?? options.onProgress,
        revision: ingestOptions.revision,
        retries: ingestOptions.retries ?? options.retries,
        concurrency: ingestOptions.concurrency ?? options.concurrency,
        abortSignal: ingestOptions.abortSignal,
      };

      if (vectorStore !== undefined) {
        return ingestGraphDocumentsToStores({
          ...shared,
          vectorStore,
          vectorProviderOptions: ingestOptions.vectorProviderOptions,
        });
      }

      return ingestGraphDocuments(shared);
    },
    retrieve: (query, retrieveOptions = {}) =>
      options.graph.retrieve({
        model: options.embeddingModel,
        query,
        search: retrieveOptions.search ?? options.search,
        traversal: retrieveOptions.traversal ?? options.traversal,
        evidence: retrieveOptions.evidence ?? options.evidence,
        retries: retrieveOptions.retries ?? options.retries,
        abortSignal: retrieveOptions.abortSignal,
      }),
    asTool: ((toolOptions: KnowledgeGraphToolOptions<Schema, Graph, unknown>) => {
      const shared = {
        name: toolOptions.name,
        description: toolOptions.description,
        graph: options.graph,
        model: options.embeddingModel,
        search: toolOptions.search ?? options.search,
        traversal: toolOptions.traversal ?? options.traversal,
        evidence: toolOptions.evidence ?? options.evidence,
        retries: toolOptions.retries ?? options.retries,
      };

      if (toolOptions.format !== undefined) {
        return createGraphSearchTool({ ...shared, format: toolOptions.format });
      }

      return createGraphSearchTool(shared);
    }) as KnowledgeGraphHandle<Schema, Graph>["asTool"],
    asContext: (contextOptions = {}) =>
      createGraphContext({
        id: contextOptions.id,
        graph: options.graph,
        model: options.embeddingModel,
        search: contextOptions.search ?? options.search,
        traversal: contextOptions.traversal ?? options.traversal,
        evidence: contextOptions.evidence ?? options.evidence,
        retries: contextOptions.retries ?? options.retries,
        format: contextOptions.format,
      }),
    explore: (exploreOptions) => {
      if (!isExplorer<Schema>(options.graph)) {
        throw new TypeError("The configured graph registration does not support explore().");
      }

      return options.graph.explore(exploreOptions);
    },
  };
  return handle;
}

function isDocumentWriter<Schema extends GraphSchemaLike>(
  value: unknown,
): value is GraphDocumentWriter<Schema> {
  return (
    typeof value === "object" &&
    value !== null &&
    "replaceDocuments" in value &&
    typeof (value as { replaceDocuments?: unknown }).replaceDocuments === "function"
  );
}

function isExplorer<Schema extends GraphSchemaLike>(
  value: unknown,
): value is GraphExplorer<Schema> {
  return (
    typeof value === "object" &&
    value !== null &&
    "explore" in value &&
    typeof (value as { explore?: unknown }).explore === "function"
  );
}

function normalizeDocuments(
  input: KnowledgeGraphIngestInput,
): TextDocument<TextDocumentMetadata>[] {
  const items = Array.isArray(input) ? input : [input];
  const documents: TextDocument<TextDocumentMetadata>[] = [];
  const autoDerivedIndexById = new Map<string, number>();

  for (const item of items) {
    const isAutoId = typeof item === "string" || item.id === undefined;
    let doc: TextDocument<TextDocumentMetadata>;

    if (typeof item === "string") {
      doc = { id: stableTextId(item), text: item };
    } else {
      const id = item.id ?? stableTextId(item.text);
      doc =
        item.metadata === undefined
          ? { id, text: item.text }
          : { id, text: item.text, metadata: item.metadata };
    }

    if (isAutoId) {
      const existingIndex = autoDerivedIndexById.get(doc.id);

      if (existingIndex !== undefined) {
        documents[existingIndex] = doc;
        continue;
      }

      autoDerivedIndexById.set(doc.id, documents.length);
    }

    documents.push(doc);
  }

  return documents;
}

function stableTextId(text: string): string {
  return `doc_${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}
