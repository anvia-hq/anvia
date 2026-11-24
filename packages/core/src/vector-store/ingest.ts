import type { JsonObject } from "../completion";
import {
  chunkTextDocuments,
  type TextDocument,
  type TextDocumentChunk,
  type TextDocumentChunkingOptions,
} from "../documents";
import {
  embedDocuments,
  type EmbeddedDocument,
  type EmbeddingModel,
  type SparseEmbeddingModel,
  type VectorMetadata,
  type VectorMetadataValue,
} from "../embeddings";
import type { RetrySetting } from "../retry";
import type { VectorStore } from "./types";

export type VectorIngestGranularity = "document" | "chunk";

type IngestVectorModelSelection =
  | Readonly<{
      model: EmbeddingModel;
      embeddingModel?: never;
      models?: never;
    }>
  | Readonly<{
      embeddingModel: EmbeddingModel;
      model?: never;
      models?: never;
    }>
  | Readonly<{
      models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
      model?: never;
      embeddingModel?: never;
    }>;

type IngestVectorDocumentsBaseOptions<Metadata extends VectorMetadata = VectorMetadata> = Readonly<{
  store: VectorStore<TextDocument<Metadata>, Metadata>;
  documents: readonly TextDocument<Metadata>[];
  chunking?: TextDocumentChunkingOptions | undefined;
  granularity?: VectorIngestGranularity | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type IngestVectorDocumentsOptions<Metadata extends VectorMetadata = VectorMetadata> =
  IngestVectorDocumentsBaseOptions<Metadata> & IngestVectorModelSelection;

export type IngestVectorTextOptions<Metadata extends VectorMetadata = VectorMetadata> = Omit<
  IngestVectorDocumentsBaseOptions<Metadata>,
  "documents"
> &
  IngestVectorModelSelection &
  Readonly<{ document: TextDocument<Metadata> }>;

export type IngestVectorDocumentsResult<Metadata extends VectorMetadata = VectorMetadata> =
  Readonly<{
    documents: readonly EmbeddedDocument<TextDocument<Metadata>, Metadata>[];
  }>;

export async function ingestVectorText<Metadata extends VectorMetadata = VectorMetadata>(
  options: IngestVectorTextOptions<Metadata>,
): Promise<IngestVectorDocumentsResult<Metadata>> {
  const { document, ...rest } = options;
  return ingestVectorDocuments({
    ...rest,
    documents: [document],
  } as IngestVectorDocumentsOptions<Metadata>);
}

export async function ingestVectorDocuments<Metadata extends VectorMetadata = VectorMetadata>(
  options: IngestVectorDocumentsOptions<Metadata>,
): Promise<IngestVectorDocumentsResult<Metadata>> {
  const granularity = options.granularity ?? "document";
  for (const document of options.documents) {
    validateVectorMetadata(document.metadata, document.id, granularity);
  }
  const chunks = chunkTextDocuments({
    documents: options.documents,
    chunking: options.chunking,
  });

  const embedded =
    granularity === "chunk"
      ? await embedChunkItems(chunks, options)
      : await embedDocumentItems(options.documents, chunks, options);

  await options.store.upsert({
    documents: embedded.documents,
    providerOptions: options.providerOptions,
  });
  return { documents: embedded.documents };
}

async function embedDocumentItems<Metadata extends VectorMetadata>(
  documents: readonly TextDocument<Metadata>[],
  chunks: readonly TextDocumentChunk<Metadata>[],
  options: IngestVectorDocumentsOptions<Metadata>,
) {
  const chunksByDocument = groupChunksByDocument(chunks);
  const base = {
    documents: [...documents],
    id: (document: TextDocument<Metadata>) => document.id,
    content: (document: TextDocument<Metadata>) => {
      const documentChunks = chunksByDocument.get(document.id);

      if (documentChunks === undefined) {
        throw new TypeError(`Text document ${document.id} has no chunks`);
      }

      return documentChunks.map((chunk) => chunk.text);
    },
    metadata: (document: TextDocument<Metadata>) => document.metadata,
    retries: options.retries,
    concurrency: options.concurrency,
    abortSignal: options.abortSignal,
  };

  if ("models" in options && options.models !== undefined) {
    return embedDocuments({ ...base, models: options.models });
  }

  const model =
    "model" in options && options.model !== undefined ? options.model : options.embeddingModel;
  return embedDocuments({ ...base, model: model as EmbeddingModel });
}

async function embedChunkItems<Metadata extends VectorMetadata>(
  chunks: readonly TextDocumentChunk<Metadata>[],
  options: IngestVectorDocumentsOptions<Metadata>,
) {
  const chunkDocuments: Array<TextDocument<Metadata>> = chunks.map((chunk) => {
    const metadata = {
      ...chunk.metadata,
      documentId: chunk.documentId,
      chunkIndex: chunk.index,
    } as unknown as Metadata;
    return {
      id: chunk.id,
      text: chunk.text,
      metadata,
    };
  });
  const base = {
    documents: chunkDocuments,
    id: (document: TextDocument<Metadata>) => document.id,
    content: (document: TextDocument<Metadata>) => document.text,
    metadata: (document: TextDocument<Metadata>) => document.metadata,
    retries: options.retries,
    concurrency: options.concurrency,
    abortSignal: options.abortSignal,
  };

  if ("models" in options && options.models !== undefined) {
    return embedDocuments({ ...base, models: options.models });
  }

  const model =
    "model" in options && options.model !== undefined ? options.model : options.embeddingModel;
  return embedDocuments({ ...base, model: model as EmbeddingModel });
}

const RESERVED_CHUNK_METADATA_KEYS = new Set(["documentId", "chunkIndex"]);

function validateVectorMetadata(
  metadata: VectorMetadata | undefined,
  documentId: string,
  granularity: VectorIngestGranularity,
): void {
  if (metadata === undefined) {
    return;
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new TypeError(`Text document ${documentId} metadata must be an object`);
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (granularity === "chunk" && RESERVED_CHUNK_METADATA_KEYS.has(key)) {
      throw new TypeError(
        `Text document ${documentId} metadata cannot use reserved key "${key}" when granularity is "chunk".`,
      );
    }

    validateVectorMetadataValue(value, `Text document ${documentId} metadata.${key}`);
  }
}

function validateVectorMetadataValue(value: VectorMetadataValue, label: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite vector metadata value`);
  }

  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
}

function groupChunksByDocument<Metadata>(
  chunks: readonly TextDocumentChunk<Metadata>[],
): ReadonlyMap<string, readonly TextDocumentChunk<Metadata>[]> {
  const grouped = new Map<string, TextDocumentChunk<Metadata>[]>();
  for (const chunk of chunks) {
    const documentChunks = grouped.get(chunk.documentId);

    if (documentChunks === undefined) {
      grouped.set(chunk.documentId, [chunk]);
    } else {
      documentChunks.push(chunk);
    }
  }
  return grouped;
}
