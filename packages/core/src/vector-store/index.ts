import { z } from "zod";
import {
  cosineSimilarity,
  type EmbeddedDocument,
  type Embedding,
  type VectorMetadata,
} from "../embeddings";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import { createTool } from "../tool/create-tool";
import type { Tool } from "../tool/tool";
import { matchesVectorFilter } from "./filter";
import { LshIndex } from "./lsh";
import { retrieveDocuments } from "./retrieve";
import type {
  IndexStrategy,
  VectorInspectItem,
  VectorInspectPage,
  VectorInspectRequest,
  VectorSearchRequest,
  VectorSearchResult,
  VectorSearchToolOptions,
  VectorStore,
  VectorStoreUpsertOptions,
} from "./types";

export { vectorFilter } from "./filter";
export { retrieveDocuments } from "./retrieve";
export type * from "./types";

type StoredDocument<T, Metadata extends VectorMetadata> = EmbeddedDocument<T, Metadata>;

export type InMemoryVectorStoreOptions = {
  dimensions?: number | undefined;
  index?: IndexStrategy | undefined;
};

export type InMemoryVectorStoreFromDocumentsOptions<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> = InMemoryVectorStoreOptions & {
  documents: Array<EmbeddedDocument<T, Metadata>>;
};

export class InMemoryVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  private readonly documents = new Map<string, StoredDocument<T, Metadata>>();
  private readonly indexStrategy: IndexStrategy;
  private lshIndex: LshIndex | undefined;
  private embeddingDimension: number | undefined;

  constructor(options: InMemoryVectorStoreOptions = {}) {
    this.indexStrategy = options.index ?? { type: "bruteForce" };
    if (
      options.dimensions !== undefined &&
      (!Number.isSafeInteger(options.dimensions) || options.dimensions < 1)
    ) {
      throw new RangeError("Vector dimensions must be a positive safe integer.");
    }
    this.embeddingDimension = options.dimensions;
  }

  static fromDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: InMemoryVectorStoreFromDocumentsOptions<T, Metadata>,
  ): InMemoryVectorStore<T, Metadata> {
    const store = new InMemoryVectorStore<T, Metadata>(options);
    store.replaceDocuments(options.documents);
    return store;
  }

  async ensure(): Promise<void> {}
  async validate(): Promise<void> {}

  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    this.replaceDocuments(options.documents);
  }

  get(options: { id: string }): StoredDocument<T, Metadata> | undefined {
    return this.documents.get(options.id);
  }

  values(): Array<StoredDocument<T, Metadata>> {
    return [...this.documents.values()];
  }

  len(): number {
    return this.documents.size;
  }

  isEmpty(): boolean {
    return this.documents.size === 0;
  }

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    throwIfAborted(request.abortSignal);
    assertPositiveSearchLimit(request.topK);
    assertFiniteMinScore(request.minScore);
    const queryEmbedding: Embedding = { document: "", vector: request.vector };
    const results = this.candidates(queryEmbedding)
      .filter((document) => matchesVectorFilter(document.metadata, request.filter))
      .flatMap((document) => {
        const score = bestScore(queryEmbedding, document.embeddings);
        if (score === undefined || (request.minScore !== undefined && score < request.minScore)) {
          return [];
        }
        let result: VectorSearchResult<T, Metadata> = {
          score,
          id: document.id,
          document: document.document,
        };
        if (document.metadata !== undefined) {
          result = { ...result, metadata: document.metadata };
        }
        return [result];
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, request.topK);
    throwIfAborted(request.abortSignal);
    return results;
  }

  async inspect(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>> {
    throwIfAborted(request.abortSignal);
    const limit = assertPositiveSearchLimit(request.limit);
    const start = Math.max(0, Math.trunc(Number(request.cursor ?? "0")));
    const documents = this.values().filter((document) =>
      matchesVectorFilter(document.metadata, request.filter),
    );
    const page = documents.slice(start, start + limit);
    const nextOffset = start + page.length;
    const result: VectorInspectPage<T, Metadata> = {
      items: page.map((document): VectorInspectItem<T, Metadata> => {
        let item: VectorInspectItem<T, Metadata> = {
          id: document.id,
          document: document.document,
        };
        if (document.metadata !== undefined) {
          item = { ...item, metadata: document.metadata };
        }
        return item;
      }),
      totalCount: documents.length,
    };
    if (nextOffset < documents.length) result.nextCursor = String(nextOffset);
    throwIfAborted(request.abortSignal);
    return result;
  }

  private replaceDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): void {
    const ids = new Set<string>();
    for (const document of documents) {
      if (ids.has(document.id)) throw new TypeError(`Duplicate vector document id: ${document.id}`);
      ids.add(document.id);
      if (document.embeddings.length === 0) {
        throw new TypeError(`Vector document ${document.id} must contain at least one embedding.`);
      }
      for (const embedding of document.embeddings)
        assertFiniteVector(embedding.vector, document.id);
    }
    this.validateDocumentDimensions(documents);
    for (const document of documents) this.documents.set(document.id, document);
    this.rebuildLshIndex();
  }

  private candidates(queryEmbedding: Embedding): Array<StoredDocument<T, Metadata>> {
    this.validateQueryDimension(queryEmbedding);
    if (this.indexStrategy.type !== "lsh" || this.lshIndex === undefined) return this.values();
    const candidateIds = this.lshIndex.query(queryEmbedding.vector);
    if (candidateIds.size === 0) return this.values();
    return [...candidateIds].flatMap((id) => {
      const document = this.documents.get(id);
      return document === undefined ? [] : [document];
    });
  }

  private rebuildLshIndex(): void {
    if (this.indexStrategy.type !== "lsh") {
      this.lshIndex = undefined;
      return;
    }
    const firstEmbedding = this.values().flatMap((document) => document.embeddings)[0];
    if (firstEmbedding === undefined) {
      this.lshIndex = undefined;
      return;
    }
    const index = new LshIndex(firstEmbedding.vector.length, this.indexStrategy);
    for (const document of this.documents.values()) {
      for (const embedding of document.embeddings) index.insert(document.id, embedding.vector);
    }
    this.lshIndex = index;
  }

  private validateDocumentDimensions(documents: Array<EmbeddedDocument<T, Metadata>>): void {
    let dimension = this.embeddingDimension;
    for (const document of documents) {
      for (const embedding of document.embeddings) {
        dimension = validateEmbeddingDimension(dimension, embedding, document.id);
      }
    }
    this.embeddingDimension = dimension;
  }

  private validateQueryDimension(queryEmbedding: Embedding): void {
    if (this.embeddingDimension !== undefined) {
      validateEmbeddingDimension(this.embeddingDimension, queryEmbedding, "query");
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

export function createVectorSearchTool<T, Metadata extends VectorMetadata>(
  options: VectorSearchToolOptions<T, Metadata>,
): Tool<{ query: string; topK?: number }, Array<VectorSearchResult<T, Metadata>>> {
  const configuredTopK = assertPositiveSearchLimit(options.topK ?? 5);
  assertFiniteMinScore(options.minScore);
  return createTool({
    name: options.name,
    description:
      options.description ?? "Search a vector store for documents relevant to the provided query.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The query string to search for relevant documents."),
      topK: z.number().int().positive().optional().describe("The maximum number of results."),
    }),
    outputSchema: z.array(
      z.object({
        score: z.number(),
        id: z.string(),
        document: z.any(),
        metadata: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      }),
    ),
    execute: ({ query, topK }, context) => {
      const request = {
        query,
        topK: topK ?? configuredTopK,
        minScore: options.minScore,
        filter: options.filter,
        retries: options.retries,
        abortSignal: context.abortSignal,
      };
      return "models" in options && options.models !== undefined
        ? retrieveDocuments({
            ...request,
            store: options.store,
            models: options.models,
            fusion: options.fusion,
          })
        : retrieveDocuments({ ...request, store: options.store, model: options.model });
    },
  }) as Tool<{ query: string; topK?: number }, Array<VectorSearchResult<T, Metadata>>>;
}

function bestScore(queryEmbedding: Embedding, embeddings: Embedding[]): number | undefined {
  let best: number | undefined;
  for (const embedding of embeddings) {
    const score = cosineSimilarity(queryEmbedding.vector, embedding.vector);
    best = best === undefined ? score : Math.max(best, score);
  }
  return best;
}

function validateEmbeddingDimension(
  expectedDimension: number | undefined,
  embedding: Embedding,
  id: string,
): number {
  assertFiniteVector(embedding.vector, id);
  if (expectedDimension === undefined) return embedding.vector.length;
  if (embedding.vector.length !== expectedDimension) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimension} dimensions but received ${embedding.vector.length} for ${id}`,
    );
  }
  return expectedDimension;
}

function assertFiniteVector(vector: number[], id: string): void {
  if (vector.length === 0) throw new TypeError(`Vector for ${id} must not be empty.`);
  if (!vector.every(Number.isFinite)) {
    throw new TypeError(`Vector for ${id} must contain only finite numbers.`);
  }
}
