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
  type VectorMetadata,
  type VectorMetadataValue,
} from "../embeddings";
import type { RetrySetting } from "../retry";
import type { VectorStore } from "./types";

export type IngestVectorDocumentsOptions<Metadata extends VectorMetadata = VectorMetadata> =
  Readonly<{
    store: VectorStore<TextDocument<Metadata>, Metadata>;
    documents: readonly TextDocument<Metadata>[];
    embeddingModel: EmbeddingModel;
    chunking?: TextDocumentChunkingOptions | undefined;
    retries?: RetrySetting | undefined;
    concurrency?: number | undefined;
    providerOptions?: JsonObject | undefined;
    abortSignal?: AbortSignal | undefined;
  }>;

export type IngestVectorTextOptions<Metadata extends VectorMetadata = VectorMetadata> = Omit<
  IngestVectorDocumentsOptions<Metadata>,
  "documents"
> &
  Readonly<{ document: TextDocument<Metadata> }>;

export type IngestVectorDocumentsResult<Metadata extends VectorMetadata = VectorMetadata> =
  Readonly<{
    documents: readonly EmbeddedDocument<TextDocument<Metadata>, Metadata>[];
  }>;

export async function ingestVectorText<Metadata extends VectorMetadata = VectorMetadata>(
  options: IngestVectorTextOptions<Metadata>,
): Promise<IngestVectorDocumentsResult<Metadata>> {
  return ingestVectorDocuments({
    store: options.store,
    documents: [options.document],
    embeddingModel: options.embeddingModel,
    chunking: options.chunking,
    retries: options.retries,
    concurrency: options.concurrency,
    providerOptions: options.providerOptions,
    abortSignal: options.abortSignal,
  });
}

export async function ingestVectorDocuments<Metadata extends VectorMetadata = VectorMetadata>(
  options: IngestVectorDocumentsOptions<Metadata>,
): Promise<IngestVectorDocumentsResult<Metadata>> {
  for (const document of options.documents) {
    validateVectorMetadata(document.metadata, document.id);
  }
  const chunks = chunkTextDocuments({
    documents: options.documents,
    chunking: options.chunking,
  });
  const chunksByDocument = groupChunksByDocument(chunks);
  const embedded = await embedDocuments({
    model: options.embeddingModel,
    documents: [...options.documents],
    id: (document) => document.id,
    content: (document) => {
      const documentChunks = chunksByDocument.get(document.id);
      if (documentChunks === undefined) {
        throw new TypeError(`Text document ${document.id} has no chunks`);
      }
      return documentChunks.map((chunk) => chunk.text);
    },
    metadata: (document) => document.metadata,
    retries: options.retries,
    concurrency: options.concurrency,
    abortSignal: options.abortSignal,
  });
  await options.store.upsert({
    documents: embedded.documents,
    providerOptions: options.providerOptions,
  });
  return { documents: embedded.documents };
}

function validateVectorMetadata(metadata: VectorMetadata | undefined, documentId: string): void {
  if (metadata === undefined) {
    return;
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new TypeError(`Text document ${documentId} metadata must be an object`);
  }
  for (const [key, value] of Object.entries(metadata)) {
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
