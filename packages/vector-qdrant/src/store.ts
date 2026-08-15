import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  HybridVectorSearchRequest,
  HybridVectorStore,
  VectorInspectItem,
  VectorInspectPage,
  VectorInspectRequest,
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { QdrantVectorClient } from "./client.js";
import { filterToQdrantFilter } from "./filters.js";
import {
  isQdrantNotFoundError,
  parseQueryResults,
  qdrantCollectionExists,
  qdrantDocumentFilter,
  qdrantDocumentPage,
  qdrantMutationRequest,
  qdrantPoints,
  qdrantResultCount,
  validateQdrantCollection,
} from "./helpers.js";
import {
  defaultDenseVectorName,
  defaultSparseVectorName,
  type QdrantDistance,
  type QdrantHybridVectorStoreOptions,
  type QdrantMutationOptions,
  type QdrantVectorStoreOptions,
} from "./types.js";

export class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  readonly mode: "dense" | "hybrid";
  readonly denseVectorName: string;
  readonly sparseVectorName: string;
  constructor(
    protected readonly owner: QdrantVectorClient,
    readonly options: QdrantVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
    this.mode = options.mode ?? "dense";
    this.denseVectorName = options.denseVectorName ?? defaultDenseVectorName;
    this.sparseVectorName = options.sparseVectorName ?? defaultSparseVectorName;
  }
  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    let exists: boolean | undefined;
    if (client.collectionExists !== undefined)
      exists = qdrantCollectionExists(await client.collectionExists(this.options.collectionName));
    if (exists === false) await this.createCollection(client);
    else if (exists === undefined) {
      try {
        await this.validate();
      } catch (error) {
        if (!isQdrantNotFoundError(error)) throw error;
        await this.createCollection(client);
      }
    }
    await this.validate();
  }
  async validate(): Promise<void> {
    const response = await (await this.owner.nativeClient()).getCollection(
      this.options.collectionName,
    );
    validateQdrantCollection(response, {
      vectorSize: this.options.dimensions,
      distance: distanceName(this.options.metric),
      hybrid: this.mode === "hybrid",
      denseVectorName: this.denseVectorName,
      sparseVectorName: this.sparseVectorName,
    });
  }
  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions, this.mode);
    if (options.documents.length === 0) return;
    const client = await this.owner.nativeClient();
    const points = options.documents.flatMap((document) =>
      qdrantPoints(document, {
        hybrid: this.mode === "hybrid",
        denseVectorName: this.denseVectorName,
        sparseVectorName: this.sparseVectorName,
      }),
    );
    const filter = qdrantDocumentFilter(options.documents.map((document) => document.id));
    const providerOptions = qdrantMutationRequest(
      (options.providerOptions ?? {}) as QdrantMutationOptions,
    );
    if (client.batchUpdate !== undefined && points.length > 0) {
      await client.batchUpdate(this.options.collectionName, {
        ...providerOptions,
        operations: [{ delete: { filter } }, { upsert: { points } }],
      });
      return;
    }
    if (client.delete === undefined)
      throw new TypeError("Qdrant document replacement requires delete(...) or batchUpdate(...).");
    await client.delete(this.options.collectionName, { ...providerOptions, wait: true, filter });
    if (points.length > 0)
      await client.upsert(this.options.collectionName, { ...providerOptions, points });
  }
  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const client = await this.owner.nativeClient();
    const filter = filterToQdrantFilter(request.filter);
    const metric = distanceName(this.options.metric);
    let candidateLimit = request.topK;
    for (;;) {
      const common = {
        ...(request.providerOptions ?? {}),
        limit: candidateLimit,
        filter,
        score_threshold:
          request.minScore === undefined
            ? undefined
            : metric === "Euclid"
              ? -request.minScore
              : request.minScore,
        with_payload: true,
      };
      const response =
        client.query !== undefined
          ? await client.query(this.options.collectionName, {
              ...common,
              query: request.vector,
              ...(this.mode === "hybrid" ? { using: this.denseVectorName } : {}),
            })
          : client.search !== undefined
            ? await client.search(this.options.collectionName, {
                ...common,
                vector:
                  this.mode === "hybrid"
                    ? { name: this.denseVectorName, vector: request.vector }
                    : request.vector,
              })
            : (() => {
                throw new TypeError("Qdrant search requires query(...) or search(...).");
              })();
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(response, undefined, metric);
      const results = selectResults(unfiltered, request);
      if (
        results.length >= request.topK ||
        qdrantResultCount(response) < candidateLimit ||
        hasResultBelowMinimum(unfiltered, request.minScore)
      )
        return results;
      const nextLimit = nextCandidateLimit(candidateLimit);
      if (nextLimit === candidateLimit) return results;
      candidateLimit = nextLimit;
    }
  }
  protected async searchHybridRequest(
    request: HybridVectorSearchRequest,
  ): Promise<Array<VectorSearchResult<T, Metadata>>> {
    if (this.mode !== "hybrid")
      throw new TypeError('Hybrid search requires vectorStore({ mode: "hybrid" }).');
    validateSearchRequest(request, this.options.dimensions);
    validateSparseVector(request.sparseVector);
    const client = await this.owner.nativeClient();
    if (client.query === undefined)
      throw new TypeError("Hybrid Qdrant search requires query(...).");
    const providerOptions = { ...(request.providerOptions ?? {}) };
    const configuredPrefetchLimit = providerOptions.prefetchLimit;
    delete providerOptions.prefetchLimit;
    if (
      configuredPrefetchLimit !== undefined &&
      (!Number.isSafeInteger(configuredPrefetchLimit) || Number(configuredPrefetchLimit) < 1)
    )
      throw new RangeError("Qdrant prefetchLimit must be a positive safe integer.");
    let candidateLimit = request.topK;
    for (;;) {
      const prefetchLimit = Math.max(
        candidateLimit,
        Number(configuredPrefetchLimit ?? candidateLimit * 5),
      );
      const response = await client.query(this.options.collectionName, {
        ...providerOptions,
        prefetch: [
          {
            query: request.vector,
            using: this.denseVectorName,
            limit: prefetchLimit,
            filter: filterToQdrantFilter(request.filter),
          },
          {
            query: request.sparseVector,
            using: this.sparseVectorName,
            limit: prefetchLimit,
            filter: filterToQdrantFilter(request.filter),
          },
        ],
        query: { fusion: request.fusion ?? "rrf" },
        limit: candidateLimit,
        with_payload: true,
      });
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(response, undefined);
      const results = selectResults(unfiltered, request);
      if (
        results.length >= request.topK ||
        qdrantResultCount(response) < candidateLimit ||
        hasResultBelowMinimum(unfiltered, request.minScore)
      )
        return results;
      const nextLimit = nextCandidateLimit(candidateLimit);
      if (nextLimit === candidateLimit) return results;
      candidateLimit = nextLimit;
    }
  }
  async inspect(request: VectorInspectRequest): Promise<VectorInspectPage<T, Metadata>> {
    throwIfAborted(request.abortSignal);
    assertInspectLimit(request.limit);
    const page = await qdrantDocumentPage<T, Metadata>(
      await this.owner.nativeClient(),
      this.options.collectionName,
      {
        ...request,
        filter: filterToQdrantFilter(request.filter),
      },
    );
    throwIfAborted(request.abortSignal);
    return page;
  }
  async delete(options: {
    documentIds: string[];
    providerOptions?: QdrantMutationOptions | undefined;
  }): Promise<void> {
    const ids = [...new Set(options.documentIds)];
    if (ids.length === 0) return;
    const client = await this.owner.nativeClient();
    if (client.delete === undefined) throw new TypeError("Qdrant deletion requires delete(...).");
    await client.delete(this.options.collectionName, {
      ...qdrantMutationRequest(options.providerOptions ?? {}),
      filter: qdrantDocumentFilter(ids),
    });
  }
  async get(options: { documentIds: string[] }): Promise<Array<VectorInspectItem<T, Metadata>>> {
    const ids = [...new Set(options.documentIds)];
    if (ids.length === 0) return [];
    const page = await qdrantDocumentPage<T, Metadata>(
      await this.owner.nativeClient(),
      this.options.collectionName,
      { limit: ids.length, filter: qdrantDocumentFilter(ids) },
    );
    const byId = new Map(page.items.map((item) => [item.id, item]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
  }
  private async createCollection(
    client: Awaited<ReturnType<QdrantVectorClient["nativeClient"]>>,
  ): Promise<void> {
    const vectors =
      this.mode === "hybrid"
        ? {
            [this.denseVectorName]: {
              size: this.options.dimensions,
              distance: distanceName(this.options.metric),
            },
          }
        : { size: this.options.dimensions, distance: distanceName(this.options.metric) };
    await client.createCollection(this.options.collectionName, {
      vectors,
      ...(this.mode === "hybrid" ? { sparse_vectors: { [this.sparseVectorName]: {} } } : {}),
    });
  }
}

function selectResults<T, Metadata extends VectorMetadata>(
  results: Array<VectorSearchResult<T, Metadata>>,
  request: VectorSearchRequest,
): Array<VectorSearchResult<T, Metadata>> {
  return results
    .filter((result) => request.minScore === undefined || result.score >= request.minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, request.topK);
}

function hasResultBelowMinimum<T, Metadata extends VectorMetadata>(
  results: Array<VectorSearchResult<T, Metadata>>,
  minScore: number | undefined,
): boolean {
  return minScore !== undefined && results.some((result) => result.score < minScore);
}

function nextCandidateLimit(current: number): number {
  return current > Math.floor(Number.MAX_SAFE_INTEGER / 2) ? current : current * 2;
}

export class QdrantHybridVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  extends QdrantVectorStore<T, Metadata>
  implements HybridVectorStore<T, Metadata>
{
  // biome-ignore lint/complexity/noUselessConstructor: narrows the public constructor to hybrid options.
  constructor(owner: QdrantVectorClient, options: QdrantHybridVectorStoreOptions) {
    super(owner, options);
  }

  searchHybrid(
    request: HybridVectorSearchRequest,
  ): Promise<Array<VectorSearchResult<T, Metadata>>> {
    return this.searchHybridRequest(request);
  }
}
function distanceName(metric: QdrantVectorStoreOptions["metric"]): QdrantDistance {
  if (metric === "euclidean") return "Euclid";
  if (metric === "dotProduct") return "Dot";
  return "Cosine";
}
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
function validateSearchRequest(request: VectorSearchRequest, dimensions: number): void {
  throwIfAborted(request.abortSignal);
  if (!Number.isSafeInteger(request.topK) || request.topK < 1)
    throw new RangeError("Vector search topK must be a positive safe integer.");
  if (request.minScore !== undefined && !Number.isFinite(request.minScore))
    throw new RangeError("Vector search minScore must be a finite number.");
  if (request.vector.length !== dimensions) throw new Error("Vector dimension mismatch for query");
}
function validateSparseVector(vector: HybridVectorSearchRequest["sparseVector"]): void {
  if (vector.indices.length !== vector.values.length)
    throw new Error("Sparse vector indices and values must have equal lengths.");
  if (!vector.indices.every((index) => Number.isSafeInteger(index) && index >= 0))
    throw new Error("Sparse vector indices must be non-negative safe integers.");
  if (!vector.values.every(Number.isFinite))
    throw new Error("Sparse vector values must be finite numbers.");
}
function assertDimensions(dimensions: number): void {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1)
    throw new RangeError("Vector dimensions must be a positive safe integer.");
}
function validateDocuments<T, Metadata extends VectorMetadata>(
  documents: Array<EmbeddedDocument<T, Metadata>>,
  dimensions: number,
  mode: "dense" | "hybrid",
): void {
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) throw new TypeError(`Duplicate vector document id: ${document.id}`);
    ids.add(document.id);
    if (document.embeddings.length === 0)
      throw new TypeError(`Vector document ${document.id} must contain at least one embedding.`);
    if (mode === "hybrid" && document.sparseEmbeddings?.length !== document.embeddings.length)
      throw new Error(
        `Hybrid document ${document.id} requires aligned dense and sparse embeddings`,
      );
    for (const embedding of document.embeddings)
      if (embedding.vector.length !== dimensions)
        throw new Error(`Vector dimension mismatch for document ${document.id}`);
      else if (!embedding.vector.every(Number.isFinite))
        throw new Error(`Vector for document ${document.id} must contain only finite numbers`);
    for (const sparseEmbedding of document.sparseEmbeddings ?? [])
      validateSparseVector(sparseEmbedding.vector);
  }
}

function assertInspectLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Vector inspection limit must be a positive safe integer.");
}
