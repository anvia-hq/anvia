import { createHash } from "node:crypto";
import { createVectorContext, type VectorContext } from "../agent/vector-context";
import type { Document, JsonObject } from "../completion";
import type { TextDocument, TextDocumentChunkingOptions } from "../documents";
import type { EmbeddingModel, SparseEmbeddingModel, VectorMetadata } from "../embeddings";
import { throwIfAborted } from "../internal/abort";
import type { RetrySetting } from "../retry";
import type { Tool } from "../tool/tool";
import {
  ingestVectorDocuments,
  type IngestVectorDocumentsResult,
  type VectorIngestGranularity,
} from "./ingest";
import { retrieveDocuments } from "./retrieve";
import type {
  HybridVectorStore,
  VectorFilterInput,
  VectorFusion,
  VectorReranker,
  VectorSearchResult,
  VectorStore,
  VectorStoreDeleteOptions,
} from "./types";

export type VectorIndexDocumentInput<Metadata extends VectorMetadata = VectorMetadata> =
  | string
  | Readonly<{
      id?: string | undefined;
      text: string;
      metadata?: Metadata | undefined;
    }>;

export type VectorIndexIngestInput<Metadata extends VectorMetadata = VectorMetadata> =
  | VectorIndexDocumentInput<Metadata>
  | readonly VectorIndexDocumentInput<Metadata>[];

export type VectorIndexIngestOptions = Readonly<{
  chunking?: TextDocumentChunkingOptions | undefined;
  granularity?: VectorIngestGranularity | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type VectorIndexRetrieveOptions<Metadata extends VectorMetadata = VectorMetadata> =
  Readonly<{
    topK?: number | undefined;
    minScore?: number | undefined;
    filter?: VectorFilterInput | undefined;
    fusion?: VectorFusion | undefined;
    rerank?: VectorReranker<TextDocument<Metadata>, Metadata> | undefined;
    candidateTopK?: number | undefined;
    retries?: RetrySetting | undefined;
    abortSignal?: AbortSignal | undefined;
  }>;

export type VectorIndexToolOptions<Metadata extends VectorMetadata = VectorMetadata> = Readonly<{
  name: string;
  description?: string | undefined;
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  fusion?: VectorFusion | undefined;
  rerank?: VectorReranker<TextDocument<Metadata>, Metadata> | undefined;
  candidateTopK?: number | undefined;
  retries?: RetrySetting | undefined;
}>;

export type VectorIndexContextOptions<Metadata extends VectorMetadata = VectorMetadata> = Readonly<{
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  fusion?: VectorFusion | undefined;
  rerank?: VectorReranker<TextDocument<Metadata>, Metadata> | undefined;
  candidateTopK?: number | undefined;
  retries?: RetrySetting | undefined;
  format?(result: VectorSearchResult<TextDocument<Metadata>>): Document;
}>;

type VectorIndexBaseOptions<Metadata extends VectorMetadata = VectorMetadata> = Readonly<{
  chunking?: TextDocumentChunkingOptions | undefined;
  granularity?: VectorIngestGranularity | undefined;
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  rerank?: VectorReranker<TextDocument<Metadata>, Metadata> | undefined;
  candidateTopK?: number | undefined;
  retries?: RetrySetting | undefined;
  concurrency?: number | undefined;
}>;

export type CreateDenseVectorIndexOptions<Metadata extends VectorMetadata = VectorMetadata> =
  VectorIndexBaseOptions<Metadata> &
    Readonly<{
      store?: VectorStore<TextDocument<Metadata>, Metadata> | undefined;
      model: EmbeddingModel;
      models?: never;
    }>;

export type CreateHybridVectorIndexOptions<Metadata extends VectorMetadata = VectorMetadata> =
  VectorIndexBaseOptions<Metadata> &
    Readonly<{
      store: HybridVectorStore<TextDocument<Metadata>, Metadata>;
      model?: never;
      models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
      fusion?: VectorFusion | undefined;
    }>;

export type CreateVectorIndexOptions<Metadata extends VectorMetadata = VectorMetadata> =
  | CreateDenseVectorIndexOptions<Metadata>
  | CreateHybridVectorIndexOptions<Metadata>;

export interface VectorIndex<Metadata extends VectorMetadata = VectorMetadata> {
  readonly store: VectorStore<TextDocument<Metadata>, Metadata>;
  ensure(): Promise<void>;
  validate(): Promise<void>;
  /**
   * Ingest one or more documents into the vector index.
   *
   * Plain-string inputs and objects without an explicit `id` derive a deterministic
   * content-hash id, so pass an explicit `{ id, text }` if you plan to replace or
   * delete the document by id later.
   */
  ingest(
    input: VectorIndexIngestInput<Metadata>,
    options?: VectorIndexIngestOptions,
  ): Promise<IngestVectorDocumentsResult<Metadata>>;
  /**
   * Delete documents by id from the underlying store.
   *
   * When the index uses `granularity: "chunk"`, document ids are resolved to their
   * stored chunk record ids via `store.inspect()`. Chunk-granularity deletion requires
   * a store that implements `inspect()`; otherwise call `store.delete()` directly with
   * chunk record ids.
   */
  delete(
    documentIds: string | readonly string[],
    options?: Omit<VectorStoreDeleteOptions, "documentIds">,
  ): Promise<void>;
  retrieve(
    query: string,
    options?: VectorIndexRetrieveOptions<Metadata>,
  ): Promise<Array<VectorSearchResult<TextDocument<Metadata>, Metadata>>>;
  asTool(
    options: VectorIndexToolOptions<Metadata>,
  ): Tool<
    { query: string; topK?: number },
    Array<VectorSearchResult<TextDocument<Metadata>, Metadata>>
  >;
  asContext(options?: VectorIndexContextOptions<Metadata>): VectorContext<TextDocument<Metadata>>;
}

type VectorIndexDependencies = Readonly<{
  createDefaultStore: <Metadata extends VectorMetadata>() => VectorStore<
    TextDocument<Metadata>,
    Metadata
  >;
  createSearchTool: typeof import("./index").createVectorSearchTool;
}>;

export function buildVectorIndex<Metadata extends VectorMetadata = VectorMetadata>(
  options: CreateVectorIndexOptions<Metadata>,
  deps: VectorIndexDependencies,
): VectorIndex<Metadata> {
  const store = options.store ?? deps.createDefaultStore<Metadata>();
  const isHybrid = "models" in options && options.models !== undefined;
  let usesChunkGranularity = options.granularity === "chunk";

  return {
    store,
    ensure: () => store.ensure(),
    validate: () => store.validate(),
    ingest: (input, ingestOptions = {}) => {
      const documents = normalizeIngestDocuments(input);
      const granularity = ingestOptions.granularity ?? options.granularity;

      if (granularity === "chunk") {
        usesChunkGranularity = true;
      }

      const shared = {
        store,
        documents,
        chunking: ingestOptions.chunking ?? options.chunking,
        granularity,
        retries: ingestOptions.retries ?? options.retries,
        concurrency: ingestOptions.concurrency ?? options.concurrency,
        providerOptions: ingestOptions.providerOptions,
        abortSignal: ingestOptions.abortSignal,
      };
      return isHybrid
        ? ingestVectorDocuments({ ...shared, models: options.models })
        : ingestVectorDocuments({ ...shared, model: options.model });
    },
    delete: async (documentIds, deleteOptions = {}) => {
      if (store.delete === undefined) {
        throw new TypeError("The configured vector store does not support delete().");
      }

      throwIfAborted(deleteOptions.abortSignal);
      const rawIds = Array.isArray(documentIds) ? documentIds : [documentIds];
      const ids = [...new Set(rawIds)];

      if (ids.length === 0) {
        return;
      }

      let recordIds: readonly string[] = ids;

      if (usesChunkGranularity) {
        if (store.inspect === undefined) {
          throw new TypeError(
            "Deleting by document id on a chunk-granularity vector index requires a store that implements inspect(); call store.delete() directly with chunk record ids instead.",
          );
        }

        const chunkIds = await collectChunkRecordIds(store, ids, deleteOptions);
        recordIds = [...new Set([...ids, ...chunkIds])];
      }

      await store.delete({
        documentIds: recordIds,
        providerOptions: deleteOptions.providerOptions,
        abortSignal: deleteOptions.abortSignal,
      });
    },
    retrieve: (query, retrieveOptions = {}) => {
      const shared = {
        query,
        topK: retrieveOptions.topK ?? options.topK,
        minScore: retrieveOptions.minScore ?? options.minScore,
        filter: retrieveOptions.filter ?? options.filter,
        rerank: retrieveOptions.rerank ?? options.rerank,
        candidateTopK: retrieveOptions.candidateTopK ?? options.candidateTopK,
        retries: retrieveOptions.retries ?? options.retries,
        abortSignal: retrieveOptions.abortSignal,
      };
      return isHybrid
        ? retrieveDocuments({
            ...shared,
            store: store as HybridVectorStore<TextDocument<Metadata>, Metadata>,
            models: options.models,
            fusion: retrieveOptions.fusion ?? options.fusion,
          })
        : retrieveDocuments({ ...shared, store, model: options.model });
    },
    asTool: (toolOptions) => {
      const shared = {
        name: toolOptions.name,
        description: toolOptions.description,
        topK: toolOptions.topK ?? options.topK,
        minScore: toolOptions.minScore ?? options.minScore,
        filter: toolOptions.filter ?? options.filter,
        rerank: toolOptions.rerank ?? options.rerank,
        candidateTopK: toolOptions.candidateTopK ?? options.candidateTopK,
        retries: toolOptions.retries ?? options.retries,
      };
      return isHybrid
        ? deps.createSearchTool({
            ...shared,
            store: store as HybridVectorStore<TextDocument<Metadata>, Metadata>,
            models: options.models,
            fusion: toolOptions.fusion ?? options.fusion,
          })
        : deps.createSearchTool({ ...shared, store, model: options.model });
    },
    asContext: (contextOptions = {}) => {
      const rerank = (contextOptions.rerank ?? options.rerank) as
        | VectorReranker<TextDocument<Metadata>>
        | undefined;
      const shared: {
        topK?: number | undefined;
        minScore?: number | undefined;
        filter?: VectorFilterInput | undefined;
        rerank?: VectorReranker<TextDocument<Metadata>>;
        candidateTopK?: number | undefined;
        retries?: RetrySetting | undefined;
        format?: (result: VectorSearchResult<TextDocument<Metadata>>) => Document;
      } = {
        topK: contextOptions.topK ?? options.topK,
        minScore: contextOptions.minScore ?? options.minScore,
        filter: contextOptions.filter ?? options.filter,
        candidateTopK: contextOptions.candidateTopK ?? options.candidateTopK,
        retries: contextOptions.retries ?? options.retries,
      };

      if (rerank !== undefined) {
        shared.rerank = rerank;
      }

      if (contextOptions.format !== undefined) {
        shared.format = contextOptions.format;
      }

      return isHybrid
        ? createVectorContext({
            ...shared,
            store: store as unknown as HybridVectorStore<TextDocument<Metadata>>,
            models: options.models,
            fusion: contextOptions.fusion ?? options.fusion,
          })
        : createVectorContext({
            ...shared,
            store: store as unknown as VectorStore<TextDocument<Metadata>>,
            model: options.model,
          });
    },
  };
}

const INSPECT_DELETE_BATCH_SIZE = 500;
const INSPECT_DELETE_PAGE_SIZE = 1000;

async function collectChunkRecordIds<Metadata extends VectorMetadata>(
  store: VectorStore<TextDocument<Metadata>, Metadata>,
  documentIds: readonly string[],
  options: Omit<VectorStoreDeleteOptions, "documentIds">,
): Promise<string[]> {
  const inspect = store.inspect;

  if (inspect === undefined) {
    return [];
  }

  const chunkIds: string[] = [];
  for (let start = 0; start < documentIds.length; start += INSPECT_DELETE_BATCH_SIZE) {
    const batch = documentIds.slice(start, start + INSPECT_DELETE_BATCH_SIZE);
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    do {
      throwIfAborted(options.abortSignal);
      const page = await inspect.call(store, {
        limit: INSPECT_DELETE_PAGE_SIZE,
        cursor,
        filter: { type: "in", key: "documentId", values: batch },
        providerOptions: options.providerOptions,
        abortSignal: options.abortSignal,
      });
      for (const item of page.items) {
        chunkIds.push(item.id);
      }

      if (page.nextCursor === undefined) {
        break;
      }

      if (seenCursors.has(page.nextCursor)) {
        throw new Error(
          `Vector store inspect() returned a repeated cursor (${page.nextCursor}) while resolving chunk ids for deletion.`,
        );
      }

      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
  }
  return chunkIds;
}

function normalizeIngestDocuments<Metadata extends VectorMetadata>(
  input: VectorIndexIngestInput<Metadata>,
): TextDocument<Metadata>[] {
  const items = Array.isArray(input) ? input : [input];
  const documents: TextDocument<Metadata>[] = [];
  const autoDerivedIndexById = new Map<string, number>();

  for (const item of items) {
    const isAutoId = typeof item === "string" || item.id === undefined;
    let doc: TextDocument<Metadata>;

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
