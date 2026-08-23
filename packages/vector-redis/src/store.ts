import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { RedisVectorClient } from "./client.js";
import { filterToRedisQuery } from "./filters.js";
import { parseQueryResults, redisHashEntries } from "./helpers.js";
import {
  documentIdField,
  type RedisDistance,
  type RedisVectorStoreOptions,
  SchemaFieldTypes,
  VectorAlgorithms,
  vectorField,
} from "./types.js";
export class RedisVectorStore<
  T,
  Metadata extends VectorMetadata = VectorMetadata,
> implements VectorStore<T, Metadata> {
  readonly keyPrefix: string;
  constructor(
    private readonly owner: RedisVectorClient,
    readonly options: RedisVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
    validateMetadataSchema(options.metadataSchema ?? {});
    this.keyPrefix = options.keyPrefix ?? `anvia:${options.indexName}:`;
  }
  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    try {
      await client.ft.info(this.options.indexName);
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      await client.ft.create(
        this.options.indexName,
        {
          [documentIdField]: { type: SchemaFieldTypes.TAG, SEPARATOR: "\u0001" },
          ...metadataSearchSchema(this.options.metadataSchema ?? {}),
          [vectorField]: {
            type: SchemaFieldTypes.VECTOR,
            ALGORITHM: VectorAlgorithms.HNSW,
            TYPE: "FLOAT32",
            DIM: this.options.dimensions,
            DISTANCE_METRIC: distanceName(this.options.metric),
          },
        },
        { ON: "HASH", PREFIX: this.keyPrefix },
      );
    }
    await this.validate();
  }
  async validate(): Promise<void> {
    const info = (await (await this.owner.nativeClient()).ft.info(this.options.indexName)) as {
      attributes?: Array<Record<string, unknown>>;
    };
    if (info.attributes === undefined) return;
    const vector = info.attributes?.find(
      (attribute) => attribute.identifier === vectorField || attribute.attribute === vectorField,
    );
    if (vector === undefined) {
      throw new Error(`Redis index ${this.options.indexName} is missing ${vectorField}`);
    }
    if (vector.dim !== undefined && Number(vector.dim) !== this.options.dimensions)
      throw new Error(
        `Redis index ${this.options.indexName} has ${String(vector.dim)} dimensions; expected ${this.options.dimensions}`,
      );
    if (
      typeof vector.distance_metric === "string" &&
      vector.distance_metric.toUpperCase() !== distanceName(this.options.metric)
    )
      throw new Error(
        `Redis index ${this.options.indexName} uses ${vector.distance_metric}; expected ${distanceName(this.options.metric)}`,
      );
    for (const key of Object.keys(this.options.metadataSchema ?? {})) {
      if (
        !info.attributes.some(
          (attribute) => attribute.identifier === key || attribute.attribute === key,
        )
      ) {
        throw new Error(`Redis index ${this.options.indexName} is missing metadata field ${key}`);
      }
    }
  }
  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const records = options.documents.flatMap((document) =>
      redisHashEntries(this.keyPrefix, document, this.options.metadataSchema ?? {}),
    );
    const client = await this.owner.nativeClient();
    const query = `@${documentIdField}:{${options.documents
      .map((document) => escapeRedis(document.id))
      .join("|")}}`;
    const keys = await matchingKeys(client, this.options.indexName, query);
    if (keys.length > 0) await client.del(keys);
    for (const record of records) await client.hSet(record.key, record.fields);
  }
  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const filter = filterToRedisQuery({
      filter: request.filter,
      metadataSchema: this.options.metadataSchema ?? {},
    });
    const client = await this.owner.nativeClient();
    let candidateLimit = request.topK;
    for (;;) {
      const knnQuery = `${filter === "*" ? "*" : filter}=>[KNN ${candidateLimit} @${vectorField} $vector AS __anvia_score]`;
      const response = await client.ft.search(this.options.indexName, knnQuery, {
        ...request.providerOptions,
        PARAMS: { vector: Buffer.from(new Float32Array(request.vector).buffer) },
        SORTBY: "__anvia_score",
        DIALECT: 2,
      });
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(
        response,
        undefined,
        distanceName(this.options.metric),
      );
      const results = selectResults(unfiltered, request);
      const candidateCount =
        (response as { documents?: Array<Record<string, unknown>> }).documents?.length ?? 0;
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

function metadataSearchSchema(
  metadataSchema: NonNullable<RedisVectorStoreOptions["metadataSchema"]>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadataSchema).map(([key, type]) => [
      key,
      type === "numeric"
        ? { type: SchemaFieldTypes.NUMERIC }
        : { type: SchemaFieldTypes.TAG, SEPARATOR: "\u0001" },
    ]),
  );
}

function validateMetadataSchema(
  metadataSchema: NonNullable<RedisVectorStoreOptions["metadataSchema"]>,
): void {
  for (const [key, type] of Object.entries(metadataSchema)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.startsWith("__anvia_")) {
      throw new TypeError(`Invalid Redis metadata schema field: ${key}`);
    }
    if (type !== "numeric" && type !== "tag") {
      throw new TypeError(`Invalid Redis metadata schema type for ${key}: ${String(type)}`);
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
function distanceName(metric: RedisVectorStoreOptions["metric"]): RedisDistance {
  if (metric === "euclidean") return "L2";
  if (metric === "dotProduct") return "IP";
  return "COSINE";
}
function escapeRedis(value: string): string {
  return value.replace(/([,.<>{}[\]"':;!@#$%^&*()\-+=~|\\/ ])/g, "\\$1");
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

async function matchingKeys(
  client: Awaited<ReturnType<RedisVectorClient["nativeClient"]>>,
  indexName: string,
  query: string,
): Promise<string[]> {
  const keys: string[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const page = (await client.ft.search(indexName, query, {
      LIMIT: { from, size: pageSize },
      RETURN: [],
    })) as { total?: number; documents?: Array<{ id?: string }> };
    const documents = page.documents ?? [];
    keys.push(
      ...documents.flatMap((document) => (typeof document.id === "string" ? [document.id] : [])),
    );
    if (
      documents.length < pageSize ||
      (page.total !== undefined && from + documents.length >= page.total)
    )
      return keys;
  }
}

function isMissingIndexError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:unknown index|no such index|index .* does not exist)/i.test(error.message)
  );
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
