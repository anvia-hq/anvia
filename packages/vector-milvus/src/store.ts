import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { MilvusVectorClient } from "./client.js";
import { filterToMilvusExpr } from "./filters.js";
import {
  ensureCollection,
  milvusResultCount,
  milvusRows,
  parseQueryResults,
  validateMilvusCollection,
} from "./helpers.js";
import { documentIdFieldName, type MilvusMetric, type MilvusVectorStoreOptions } from "./types.js";

export class MilvusVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  constructor(
    private readonly owner: MilvusVectorClient,
    readonly options: MilvusVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
  }

  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    await ensureCollection(
      client,
      this.options.collectionName,
      this.options.dimensions,
      metricName(this.options.metric),
    );
    await this.validate();
  }

  async validate(): Promise<void> {
    const client = await this.owner.nativeClient();
    const { value } = await client.hasCollection({ collection_name: this.options.collectionName });
    if (!value) throw new Error(`Milvus collection ${this.options.collectionName} does not exist`);
    if (client.describeCollection !== undefined) {
      validateMilvusCollection(
        await client.describeCollection({ collection_name: this.options.collectionName }),
        this.options.collectionName,
        this.options.dimensions,
      );
    }
    await client.loadCollection({ collection_name: this.options.collectionName });
  }

  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const client = await this.owner.nativeClient();
    const ids = options.documents.map((document) => JSON.stringify(document.id)).join(", ");
    await client.delete({
      collection_name: this.options.collectionName,
      filter: `${documentIdFieldName} in [${ids}]`,
    });
    const data = options.documents.flatMap((document) => milvusRows(document));
    if (data.length > 0)
      await client.insert({
        ...(options.providerOptions ?? {}),
        collection_name: this.options.collectionName,
        data,
      });
  }

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const client = await this.owner.nativeClient();
    let candidateLimit = request.topK;
    for (;;) {
      const response = await client.search({
        ...(request.providerOptions ?? {}),
        collection_name: this.options.collectionName,
        data: [request.vector],
        limit: candidateLimit,
        filter: filterToMilvusExpr(request.filter),
        output_fields: ["*"],
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
        milvusResultCount(response) < candidateLimit ||
        hasResultBelowMinimum(unfiltered, request.minScore)
      )
        return results;
      const nextLimit = nextCandidateLimit(candidateLimit);
      if (nextLimit === candidateLimit) return results;
      candidateLimit = nextLimit;
    }
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

function metricName(metric: MilvusVectorStoreOptions["metric"]): MilvusMetric {
  if (metric === "euclidean") return "L2";
  if (metric === "dotProduct") return "IP";
  return "COSINE";
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
