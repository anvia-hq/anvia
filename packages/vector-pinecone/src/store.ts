import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { PineconeVectorClient } from "./client.js";
import { filterToPineconeFilter } from "./filters.js";
import { parseQueryResults, pineconeResultCount, pineconeVectors } from "./helpers.js";
import {
  documentIdMetadataKey,
  type PineconeMetric,
  type PineconeNamespaceLike,
  type PineconeVectorStoreOptions,
} from "./types.js";
export class PineconeVectorStore<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> implements VectorStore<T, Metadata> {
  constructor(
    private readonly owner: PineconeVectorClient,
    readonly options: PineconeVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
  }
  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    if (!(await indexExists(client, this.options.indexName))) {
      if (this.options.spec === undefined)
        throw new TypeError(
          "Pinecone ensure() requires vectorStore({ spec }) when the index is missing.",
        );
      await client.createIndex({
        name: this.options.indexName,
        dimension: this.options.dimensions,
        metric: metricName(this.options.metric),
        spec: this.options.spec,
        waitUntilReady: true,
      });
    }
    await this.validate();
  }
  async validate(): Promise<void> {
    const client = await this.owner.nativeClient();
    if (!(await indexExists(client, this.options.indexName)))
      throw new Error(`Pinecone index ${this.options.indexName} does not exist`);
    if (client.describeIndex !== undefined) {
      const raw = (await client.describeIndex(this.options.indexName)) as {
        dimension?: unknown;
        metric?: unknown;
      };
      if (typeof raw.dimension === "number" && raw.dimension !== this.options.dimensions)
        throw new Error(
          `Pinecone index dimension ${raw.dimension} does not match requested dimensions ${this.options.dimensions}`,
        );
      if (typeof raw.metric === "string" && raw.metric !== metricName(this.options.metric))
        throw new Error(
          `Pinecone index metric ${raw.metric} does not match requested metric ${metricName(this.options.metric)}`,
        );
    }
  }
  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const namespace = await this.namespace();
    await namespace.deleteMany({
      filter: {
        [documentIdMetadataKey]: { $in: options.documents.map((document) => document.id) },
      },
    });
    const vectors = options.documents.flatMap((document) => pineconeVectors(document));
    if (vectors.length > 0)
      await namespace.upsert({ ...options.providerOptions, records: vectors });
  }
  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const namespace = await this.namespace();
    let candidateLimit = request.topK;
    for (;;) {
      const response = await namespace.query({
        ...request.providerOptions,
        vector: request.vector,
        topK: candidateLimit,
        filter: filterToPineconeFilter(request.filter),
        includeMetadata: true,
        includeValues: false,
      });
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(
        response,
        undefined,
        metricName(this.options.metric),
      );
      const results = selectResults(unfiltered, request);
      if (
        results.length >= request.topK ||
        pineconeResultCount(response) < candidateLimit ||
        hasResultBelowMinimum(unfiltered, request.minScore)
      )
        return results;
      const nextLimit = nextCandidateLimit(candidateLimit);
      if (nextLimit === candidateLimit) return results;
      candidateLimit = nextLimit;
    }
  }
  private async namespace(): Promise<PineconeNamespaceLike> {
    return (await this.owner.nativeClient())
      .index(this.options.indexName)
      .namespace(this.options.namespace ?? "");
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
async function indexExists(
  client: Awaited<ReturnType<PineconeVectorClient["nativeClient"]>>,
  name: string,
): Promise<boolean> {
  const raw = (await client.listIndexes()) as
    | { indexes?: Array<{ name?: string }> }
    | Array<{ name?: string }>;
  const indexes = Array.isArray(raw) ? raw : (raw.indexes ?? []);
  return indexes.some((index) => index.name === name);
}
function metricName(metric: PineconeVectorStoreOptions["metric"]): PineconeMetric {
  if (metric === "euclidean") return "euclidean";
  if (metric === "dotProduct") return "dotproduct";
  return "cosine";
}
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
function assertDimensions(dimensions: number): void {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1)
    throw new RangeError("Vector dimensions must be a positive safe integer.");
}
function validateDocuments<T, Metadata extends VectorMetadata>(
  documents: Array<EmbeddedDocument<T, Metadata>>,
  dimensions: number,
): void {
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) throw new TypeError(`Duplicate vector document id: ${document.id}`);
    ids.add(document.id);
    if (document.embeddings.length === 0)
      throw new TypeError(`Vector document ${document.id} must contain at least one embedding.`);
    for (const embedding of document.embeddings)
      if (embedding.vector.length !== dimensions)
        throw new Error(`Vector dimension mismatch for document ${document.id}`);
      else if (!embedding.vector.every(Number.isFinite))
        throw new Error(`Vector for document ${document.id} must contain only finite numbers`);
  }
}

function validateSearchRequest(request: VectorSearchRequest, dimensions: number): void {
  throwIfAborted(request.abortSignal);
  if (!Number.isSafeInteger(request.topK) || request.topK < 1)
    throw new RangeError("Vector search topK must be a positive safe integer.");
  if (request.minScore !== undefined && !Number.isFinite(request.minScore))
    throw new RangeError("Vector search minScore must be a finite number.");
  if (request.vector.length !== dimensions) throw new Error("Vector dimension mismatch for query");
  if (!request.vector.every(Number.isFinite))
    throw new Error("Vector search query must contain only finite numbers");
}
