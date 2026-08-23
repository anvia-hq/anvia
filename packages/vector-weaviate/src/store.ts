import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { WeaviateVectorClient } from "./client.js";
import { filterToWeaviateWhere } from "./filters.js";
import { parseQueryResults, weaviateObjects } from "./helpers.js";
import {
  documentIdPropertyKey,
  type WeaviateDistance,
  type WeaviateVectorStoreOptions,
} from "./types.js";
export class WeaviateVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  constructor(
    private readonly owner: WeaviateVectorClient,
    readonly options: WeaviateVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
  }
  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    if (!(await client.collections.exists(this.options.collectionName))) {
      const module = await import("weaviate-client");
      const weaviate = module.default ?? module;
      await client.collections.create({
        name: this.options.collectionName,
        vectorizers: weaviate.configure.vectors.selfProvided({
          vectorIndexConfig: weaviate.configure.vectorIndex.hnsw({
            distanceMetric: distanceName(this.options.metric),
          }),
        }),
        properties: [
          { name: documentIdPropertyKey, dataType: "text" },
          { name: "__anvia_document", dataType: "text" },
        ],
      });
    }
    await this.validate();
  }
  async validate(): Promise<void> {
    const collections = (await this.owner.nativeClient()).collections;
    if (!(await collections.exists(this.options.collectionName)))
      throw new Error(`Weaviate collection ${this.options.collectionName} does not exist`);
    if (collections.export === undefined) return;
    const config = (await collections.export(this.options.collectionName)) as {
      vectorizers?: Record<string, { indexConfig?: { distance?: unknown } }>;
    };
    const actualMetric = Object.values(config.vectorizers ?? {})[0]?.indexConfig?.distance;
    if (typeof actualMetric === "string" && actualMetric !== distanceName(this.options.metric)) {
      throw new Error(
        `Weaviate collection ${this.options.collectionName} uses ${actualMetric}; expected ${distanceName(this.options.metric)}`,
      );
    }
  }
  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const client = await this.owner.nativeClient();
    const collection = client.collections.get(this.options.collectionName);
    if (collection.data === undefined)
      throw new TypeError(
        "Weaviate document replacement requires collection.data.deleteMany(...) and insertMany(...).",
      );
    const deletion = await collection.data.deleteMany(
      {
        target: { property: documentIdPropertyKey },
        operator: "ContainsAny",
        value: options.documents.map((document) => document.id),
      },
      options.providerOptions,
    );
    assertDeleteManySucceeded(deletion);
    const objects = options.documents.flatMap((document) => weaviateObjects(document));
    if (objects.length === 0) return;
    const insertion = await collection.data.insertMany(objects);
    assertInsertManySucceeded(insertion);
  }
  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const collection = (await this.owner.nativeClient()).collections.get(
      this.options.collectionName,
    );
    let candidateLimit = request.topK;
    for (;;) {
      const response = await collection.query.nearVector(
        request.vector,
        {
          ...(request.providerOptions ?? {}),
          limit: candidateLimit,
          filters: filterToWeaviateWhere(request.filter),
          returnMetadata: ["distance"],
          returnProperties: ["*"],
        },
        { abortSignal: request.abortSignal },
      );
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(
        response,
        undefined,
        distanceName(this.options.metric),
      );
      const results = selectResults(unfiltered, request);
      const candidateCount =
        (response as { objects?: Array<Record<string, unknown>> }).objects?.length ?? 0;
      if (
        results.length >= request.topK ||
        candidateCount < candidateLimit ||
        hasResultBelowMinimum(unfiltered, request.minScore)
      )
        return results;
      const nextLimit = nextCandidateLimit(candidateLimit);
      if (nextLimit === candidateLimit) return results;
      candidateLimit = nextLimit;
    }
  }
}

function assertDeleteManySucceeded(result: unknown): void {
  const failed = (result as { failed?: unknown } | null | undefined)?.failed;
  if (typeof failed === "number" && failed > 0) {
    throw new Error(`Weaviate failed to delete ${failed} existing vector objects.`);
  }
}

function assertInsertManySucceeded(result: unknown): void {
  const batch = result as
    | { hasErrors?: unknown; errors?: Record<string | number, unknown> | undefined }
    | null
    | undefined;
  const errorCount = Object.keys(batch?.errors ?? {}).length;
  if (batch?.hasErrors === true || errorCount > 0) {
    throw new Error(`Weaviate failed to insert ${errorCount || "one or more"} vector objects.`);
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
function distanceName(metric: WeaviateVectorStoreOptions["metric"]): WeaviateDistance {
  if (metric === "euclidean") return "l2-squared";
  if (metric === "dotProduct") return "dot";
  return metric ?? "cosine";
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
