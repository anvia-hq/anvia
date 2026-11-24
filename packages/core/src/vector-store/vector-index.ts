import { createHash } from "node:crypto";
import { createVectorContext, type VectorContext } from "../agent/vector-context";
import type { Document, JsonObject } from "../completion";
import type { TextDocument, TextDocumentChunkingOptions } from "../documents";
import type { EmbeddingModel, SparseEmbeddingModel, VectorMetadata } from "../embeddings";
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
  ingest(
    input: VectorIndexIngestInput<Metadata>,
    options?: VectorIndexIngestOptions,
  ): Promise<IngestVectorDocumentsResult<Metadata>>;
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

  return {
    store,
    ensure: () => store.ensure(),
    validate: () => store.validate(),
    ingest: (input, ingestOptions = {}) => {
      const documents = normalizeIngestDocuments(input);
      const shared = {
        store,
        documents,
        chunking: ingestOptions.chunking ?? options.chunking,
        granularity: ingestOptions.granularity ?? options.granularity,
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

      const ids = Array.isArray(documentIds) ? documentIds : [documentIds];
      await store.delete({
        documentIds: ids,
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

function normalizeIngestDocuments<Metadata extends VectorMetadata>(
  input: VectorIndexIngestInput<Metadata>,
): TextDocument<Metadata>[] {
  const items = Array.isArray(input) ? input : [input];
  return items.map((item) => {
    if (typeof item === "string") {
      return { id: stableTextId(item), text: item };
    }

    const id = item.id ?? stableTextId(item.text);

    if (item.metadata === undefined) {
      return { id, text: item.text };
    }

    return { id, text: item.text, metadata: item.metadata };
  });
}

function stableTextId(text: string): string {
  return `doc_${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}
