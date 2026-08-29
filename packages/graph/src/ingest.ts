import type { CompletionModel, JsonObject, RetrySetting, Usage } from "@anvia/core";
import {
  chunkTextDocuments,
  type TextDocument,
  type TextDocumentChunk,
  type TextDocumentChunkingOptions,
  type TextDocumentMetadata,
} from "@anvia/core/documents";
import { embedDocuments, type EmbeddedDocument, type EmbeddingModel } from "@anvia/core/embeddings";
import { extractGraphFacts } from "./extract.js";
import { parseGraphProperties } from "./schema.js";
import type {
  GraphChunk,
  GraphDocument,
  GraphDocumentWriter,
  GraphEntity,
  GraphExtractionWarning,
  GraphFactConflictOptions,
  GraphMention,
  GraphOrphanEntityPolicy,
  GraphProperties,
  GraphRelationship,
  GraphSchemaLike,
  GraphWriteConflict,
  GraphWriteResult,
} from "./types.js";

type GraphPreparationOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
> = Readonly<{
  graph: Readonly<{ schema: Schema }>;
  documents: readonly TextDocument<TextDocumentMetadata>[];
  extractionModel: ExtractionModel;
  embeddingModel: EmbeddingModel;
  chunking?: TextDocumentChunkingOptions | undefined;
  entityText?: ((entity: GraphEntity<Schema>) => string) | undefined;
  instructions?: string | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  factConflicts?: GraphFactConflictOptions | undefined;
  revision?: string | undefined;
}>;

export type PrepareGraphDocumentsOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel = CompletionModel,
> = GraphPreparationOptions<Schema, ExtractionModel>;

export type IngestGraphDocumentsOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel = CompletionModel,
> = Omit<GraphPreparationOptions<Schema, ExtractionModel>, "graph"> &
  Readonly<{
    graph: GraphDocumentWriter<Schema>;
    conflict: GraphWriteConflict;
    orphanEntities: GraphOrphanEntityPolicy;
  }>;

export type IngestGraphTextOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel = CompletionModel,
> = Omit<IngestGraphDocumentsOptions<Schema, ExtractionModel>, "documents"> &
  Readonly<{ document: TextDocument<TextDocumentMetadata> }>;

export type PreparedGraphDocuments<Schema extends GraphSchemaLike> = Readonly<{
  documents: readonly GraphDocument[];
  chunks: readonly EmbeddedDocument<GraphChunk<TextDocumentMetadata>, TextDocumentMetadata>[];
  vectorDocuments: readonly EmbeddedDocument<
    TextDocument<TextDocumentMetadata>,
    TextDocumentMetadata
  >[];
  entities: readonly EmbeddedDocument<GraphEntity<Schema>>[];
  relationships: readonly GraphRelationship<Schema>[];
  mentions: readonly GraphMention[];
  usage: Usage;
  warnings: readonly GraphExtractionWarning[];
}>;

export type IngestGraphDocumentsResult<Schema extends GraphSchemaLike> =
  PreparedGraphDocuments<Schema> &
    Readonly<{ write: GraphWriteResult; receipt: GraphIngestionReceipt }>;

export type GraphIngestionReceipt = Readonly<{
  documentIds: readonly string[];
  revision?: string | undefined;
  entityKeys: readonly string[];
  relationshipKeys: readonly string[];
  vectorDocumentIds: readonly string[];
  graphWrite: Readonly<{ status: "completed"; result: GraphWriteResult }>;
  vectorWrite: Readonly<{ status: "not-requested" | "completed" | "failed" }>;
  warnings: readonly GraphExtractionWarning[];
}>;

export type GraphVectorWriter = Readonly<{
  upsert(options: {
    documents: Array<EmbeddedDocument<TextDocument<TextDocumentMetadata>, TextDocumentMetadata>>;
    providerOptions?: JsonObject | undefined;
  }): Promise<void>;
}>;

export type IngestGraphDocumentsToStoresOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel = CompletionModel,
> = IngestGraphDocumentsOptions<Schema, ExtractionModel> &
  Readonly<{
    vectorStore: GraphVectorWriter;
    vectorProviderOptions?: JsonObject | undefined;
  }>;

export type IngestGraphTextToStoresOptions<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel = CompletionModel,
> = Omit<IngestGraphDocumentsToStoresOptions<Schema, ExtractionModel>, "documents"> &
  Readonly<{ document: TextDocument<TextDocumentMetadata> }>;

export class GraphIngestionStageError extends Error {
  readonly code = "GRAPH_INGESTION_STAGE_FAILED" as const;
  readonly stage = "vector" as const;

  constructor(
    readonly receipt: GraphIngestionReceipt,
    cause: unknown,
  ) {
    super("Graph ingestion completed, but the vector write failed.", { cause });
    this.name = "GraphIngestionStageError";
  }
}

export async function ingestGraphText<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
>(
  options: IngestGraphTextOptions<Schema, ExtractionModel>,
): Promise<IngestGraphDocumentsResult<Schema>> {
  return ingestGraphDocuments({
    graph: options.graph,
    documents: [options.document],
    extractionModel: options.extractionModel,
    embeddingModel: options.embeddingModel,
    chunking: options.chunking,
    entityText: options.entityText,
    instructions: options.instructions,
    retries: options.retries,
    concurrency: options.concurrency,
    abortSignal: options.abortSignal,
    factConflicts: options.factConflicts,
    revision: options.revision,
    conflict: options.conflict,
    orphanEntities: options.orphanEntities,
  });
}

export async function ingestGraphDocuments<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
>(
  options: IngestGraphDocumentsOptions<Schema, ExtractionModel>,
): Promise<IngestGraphDocumentsResult<Schema>> {
  const prepared = await prepareGraphDocuments(options);
  const write = await options.graph.replaceDocuments({
    documents: prepared.documents,
    chunks: prepared.chunks,
    entities: prepared.entities,
    relationships: prepared.relationships,
    mentions: prepared.mentions,
    conflict: options.conflict,
    orphanEntities: options.orphanEntities,
    abortSignal: options.abortSignal,
  });
  return {
    ...prepared,
    write,
    receipt: ingestionReceipt(prepared, write, options.revision, "not-requested"),
  };
}

export async function ingestGraphTextToStores<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
>(
  options: IngestGraphTextToStoresOptions<Schema, ExtractionModel>,
): Promise<IngestGraphDocumentsResult<Schema>> {
  return ingestGraphDocumentsToStores({ ...options, documents: [options.document] });
}

export async function ingestGraphDocumentsToStores<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
>(
  options: IngestGraphDocumentsToStoresOptions<Schema, ExtractionModel>,
): Promise<IngestGraphDocumentsResult<Schema>> {
  const result = await ingestGraphDocuments(options);
  try {
    await options.vectorStore.upsert({
      documents: [...result.vectorDocuments],
      providerOptions: options.vectorProviderOptions,
    });
  } catch (error) {
    throw new GraphIngestionStageError(
      { ...result.receipt, vectorWrite: { status: "failed" } },
      error,
    );
  }
  return {
    ...result,
    receipt: { ...result.receipt, vectorWrite: { status: "completed" } },
  };
}

export async function prepareGraphDocuments<
  Schema extends GraphSchemaLike,
  ExtractionModel extends CompletionModel,
>(
  options: PrepareGraphDocumentsOptions<Schema, ExtractionModel>,
): Promise<PreparedGraphDocuments<Schema>> {
  if (options.revision !== undefined && options.revision.trim().length === 0) {
    throw new TypeError("Graph ingestion revision must be a non-empty string.");
  }
  validatePortableMetadata(options.documents);
  const chunks = chunkTextDocuments({
    documents: options.documents,
    chunking: options.chunking,
  });
  const graphChunks: GraphChunk<TextDocumentMetadata>[] = chunks.map((chunk) => graphChunk(chunk));
  const [facts, embeddedChunks] = await Promise.all([
    extractGraphFacts({
      model: options.extractionModel,
      schema: options.graph.schema,
      chunks: graphChunks,
      instructions: options.instructions,
      retries: options.retries,
      concurrency: options.concurrency,
      abortSignal: options.abortSignal,
      conflicts: options.factConflicts,
    }),
    embedDocuments({
      model: options.embeddingModel,
      documents: graphChunks,
      id: (chunk) => chunk.id,
      content: (chunk) => chunk.text,
      metadata: (chunk) => chunk.metadata,
      retries: options.retries,
      concurrency: options.concurrency,
      abortSignal: options.abortSignal,
    }),
  ]);
  const embeddedEntities = await embedDocuments({
    model: options.embeddingModel,
    documents: [...facts.output.entities],
    id: (entity) => entity.key,
    content: options.entityText ?? defaultGraphEntityText,
    retries: options.retries,
    concurrency: options.concurrency,
    abortSignal: options.abortSignal,
  });
  const vectorDocuments = groupVectorDocuments(options.documents, embeddedChunks.documents);
  return {
    documents: options.documents.map((document) => graphDocument(document)),
    chunks: embeddedChunks.documents,
    vectorDocuments,
    entities: embeddedEntities.documents,
    relationships: facts.output.relationships,
    mentions: facts.output.mentions,
    usage: facts.usage,
    warnings: facts.warnings,
  };
}

function ingestionReceipt<Schema extends GraphSchemaLike>(
  prepared: PreparedGraphDocuments<Schema>,
  write: GraphWriteResult,
  revision: string | undefined,
  vectorStatus: GraphIngestionReceipt["vectorWrite"]["status"],
): GraphIngestionReceipt {
  return {
    documentIds: prepared.documents.map((document) => document.id),
    ...(revision === undefined ? {} : { revision }),
    entityKeys: prepared.entities.map((entity) => entity.id),
    relationshipKeys: prepared.relationships.map((relationship) => relationship.key),
    vectorDocumentIds: prepared.vectorDocuments.map((document) => document.id),
    graphWrite: { status: "completed", result: write },
    vectorWrite: { status: vectorStatus },
    warnings: prepared.warnings,
  };
}

function validatePortableMetadata(documents: readonly TextDocument<TextDocumentMetadata>[]): void {
  for (const document of documents) {
    if (document.metadata === undefined) {
      continue;
    }
    const metadata = parseGraphProperties(
      document.metadata,
      `Text document ${document.id} metadata`,
    );
    for (const [key, value] of Object.entries(metadata)) {
      if (Array.isArray(value)) {
        throw new TypeError(
          `Text document ${document.id} metadata.${key} must be a portable primitive value`,
        );
      }
    }
  }
}

function groupVectorDocuments(
  documents: readonly TextDocument<TextDocumentMetadata>[],
  chunks: readonly EmbeddedDocument<GraphChunk<TextDocumentMetadata>, TextDocumentMetadata>[],
): readonly EmbeddedDocument<TextDocument<TextDocumentMetadata>, TextDocumentMetadata>[] {
  const chunksByDocument = new Map<
    string,
    EmbeddedDocument<GraphChunk<TextDocumentMetadata>, TextDocumentMetadata>[]
  >();
  for (const chunk of chunks) {
    const documentChunks = chunksByDocument.get(chunk.document.documentId);
    if (documentChunks === undefined) {
      chunksByDocument.set(chunk.document.documentId, [chunk]);
    } else {
      documentChunks.push(chunk);
    }
  }
  return documents.map((document) => {
    const documentChunks = chunksByDocument.get(document.id);
    if (documentChunks === undefined) {
      throw new TypeError(`Text document ${document.id} has no embedded graph chunks`);
    }
    const embeddedDocument: EmbeddedDocument<
      TextDocument<TextDocumentMetadata>,
      TextDocumentMetadata
    > = {
      id: document.id,
      document,
      embeddings: documentChunks.flatMap((chunk) => chunk.embeddings),
    };
    if (document.metadata !== undefined) {
      embeddedDocument.metadata = document.metadata;
    }
    return embeddedDocument;
  });
}

function graphDocument(document: TextDocument<TextDocumentMetadata>): GraphDocument {
  if (document.metadata === undefined) {
    return { id: document.id };
  }
  return { id: document.id, properties: document.metadata };
}

function graphChunk(
  chunk: TextDocumentChunk<TextDocumentMetadata>,
): GraphChunk<TextDocumentMetadata> {
  if (chunk.metadata === undefined) {
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      index: chunk.index,
      text: chunk.text,
    };
  }
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    index: chunk.index,
    text: chunk.text,
    metadata: chunk.metadata,
  };
}

function defaultGraphEntityText(entity: GraphEntity<GraphSchemaLike>): string {
  const properties = Object.entries(entity.properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${formatGraphProperty(value)}`)
    .join("\n");
  return properties.length === 0 ? entity.type : `${entity.type}\n${properties}`;
}

function formatGraphProperty(value: GraphProperties[string]): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}
