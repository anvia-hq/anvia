import { chunkText } from "./chunk-text";

export type TextDocumentMetadata = Record<string, string | number | boolean>;

export type TextDocument<Metadata = TextDocumentMetadata> = Readonly<{
  id: string;
  text: string;
  metadata?: Metadata | undefined;
}>;

export type TextDocumentChunk<Metadata = TextDocumentMetadata> = Readonly<{
  id: string;
  documentId: string;
  index: number;
  text: string;
  metadata?: Metadata | undefined;
}>;

export type TextDocumentChunkingOptions =
  | Readonly<{ strategy: "none" }>
  | Readonly<{
      strategy: "fixed";
      maxSize: number;
      overlap?: number | undefined;
    }>
  | Readonly<{
      strategy: "recursive";
      maxSize: number;
      overlap?: number | undefined;
      separators: readonly string[];
    }>;

export type ChunkTextDocumentsOptions<Metadata = TextDocumentMetadata> = Readonly<{
  documents: readonly TextDocument<Metadata>[];
  chunking?: TextDocumentChunkingOptions | undefined;
}>;

export function chunkTextDocuments<Metadata>(
  options: ChunkTextDocumentsOptions<Metadata>,
): readonly TextDocumentChunk<Metadata>[] {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("chunkTextDocuments options must contain a documents array");
  }
  const documents = options.documents;
  if (!Array.isArray(documents)) {
    throw new TypeError("chunkTextDocuments options must contain a documents array");
  }

  const ids = new Set<string>();
  const chunks: TextDocumentChunk<Metadata>[] = [];
  for (const document of documents as readonly TextDocument<Metadata>[]) {
    validateDocument(document, ids);
    chunks.push(...chunkDocument(document, options.chunking));
  }
  return chunks;
}

function validateDocument<Metadata>(document: TextDocument<Metadata>, ids: Set<string>): void {
  if (typeof document !== "object" || document === null) {
    throw new TypeError("Text documents must be objects");
  }
  if (typeof document.id !== "string" || document.id.length === 0) {
    throw new TypeError("Text document ids must be non-empty strings");
  }
  if (ids.has(document.id)) {
    throw new TypeError(`Duplicate text document id: ${document.id}`);
  }
  if (typeof document.text !== "string" || document.text.length === 0) {
    throw new TypeError(`Text document ${document.id} must contain non-empty text`);
  }
  ids.add(document.id);
}

function chunkDocument<Metadata>(
  document: TextDocument<Metadata>,
  chunking: TextDocumentChunkingOptions | undefined,
): readonly TextDocumentChunk<Metadata>[] {
  if (chunking === undefined || chunking.strategy === "none") {
    return [createDocumentChunk(document, 0, document.text)];
  }

  const textChunks = chunkDocumentText(document.text, chunking);
  return textChunks.map((chunk) => createDocumentChunk(document, chunk.index, chunk.text));
}

function chunkDocumentText(
  text: string,
  chunking: Exclude<TextDocumentChunkingOptions, Readonly<{ strategy: "none" }>>,
) {
  const overlap = chunking.overlap ?? 0;
  if (chunking.strategy === "fixed") {
    return chunkText({
      text,
      strategy: "fixed",
      maxSize: chunking.maxSize,
      overlap,
    });
  }
  return chunkText({
    text,
    strategy: "recursive",
    maxSize: chunking.maxSize,
    overlap,
    separators: chunking.separators,
  });
}

function createDocumentChunk<Metadata>(
  document: TextDocument<Metadata>,
  index: number,
  text: string,
): TextDocumentChunk<Metadata> {
  const chunk = {
    id: `${document.id}:chunk:${index}`,
    documentId: document.id,
    index,
    text,
  };
  if (document.metadata === undefined) {
    return chunk;
  }
  return { ...chunk, metadata: document.metadata };
}
