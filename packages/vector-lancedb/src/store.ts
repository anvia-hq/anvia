import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import type { LanceDBVectorClient } from "./client.js";
import { filterToLanceExpr } from "./filters.js";
import { lanceRows, parseQueryResults } from "./helpers.js";
import {
  documentColumn,
  documentIdColumn,
  type LanceDBVectorStoreOptions,
  metadataColumn,
  rowIdColumn,
  vectorColumn,
} from "./types.js";

export class LanceDBVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  constructor(
    private readonly owner: LanceDBVectorClient,
    readonly options: LanceDBVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
  }

  async ensure(): Promise<void> {
    const connection = await this.owner.nativeClient();
    if (!(await connection.tableNames()).includes(this.options.tableName)) {
      if (connection.createEmptyTable === undefined) {
        throw new TypeError("LanceDB provisioning requires createEmptyTable(...).");
      }
      const { Field, FixedSizeList, Float32, Schema, Utf8 } = await import("apache-arrow");
      await connection.createEmptyTable(
        this.options.tableName,
        new Schema([
          new Field(rowIdColumn, new Utf8(), false),
          new Field(documentIdColumn, new Utf8(), false),
          new Field(documentColumn, new Utf8(), false),
          new Field(metadataColumn, new Utf8(), false),
          new Field(
            vectorColumn,
            new FixedSizeList(this.options.dimensions, new Field("item", new Float32(), true)),
            false,
          ),
        ]),
      );
    }
    await this.validate();
  }

  async validate(): Promise<void> {
    const table = await (await this.owner.nativeClient()).openTable(this.options.tableName);
    if (table.schema === undefined) return;
    const schema = await table.schema();
    const vectorField = schema.fields?.find((field) => field.name === vectorColumn);
    if (vectorField === undefined) {
      throw new Error(`LanceDB table ${this.options.tableName} is missing ${vectorColumn}`);
    }
    if (!schema.fields?.some((field) => field.name === metadataColumn)) {
      throw new Error(`LanceDB table ${this.options.tableName} is missing ${metadataColumn}`);
    }
    const listSize = (vectorField.type as { listSize?: unknown } | undefined)?.listSize;
    if (typeof listSize === "number" && listSize !== this.options.dimensions) {
      throw new Error(
        `LanceDB table ${this.options.tableName} has ${listSize} dimensions; expected ${this.options.dimensions}`,
      );
    }
  }

  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const table = await (await this.owner.nativeClient()).openTable(this.options.tableName);
    const ids = options.documents.map((document) => sqlString(document.id)).join(", ");
    await table.delete(`${documentIdColumn} IN (${ids})`);
    const rows = options.documents.flatMap((document) => lanceRows(document));
    if (rows.length > 0) await table.add(rows, options.providerOptions);
  }

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const table = await (await this.owner.nativeClient()).openTable(this.options.tableName);
    let candidateLimit = request.topK;
    for (;;) {
      let query = table
        .search(request.vector)
        .distanceType(metricName(this.options.metric))
        .limit(candidateLimit);
      const filter = filterToLanceExpr(request.filter);
      if (filter !== undefined) query = query.where(filter);
      const response = await query.toArray();
      throwIfAborted(request.abortSignal);
      const unfiltered = parseQueryResults<T, Metadata>(response, undefined, this.options.metric);
      const results = selectResults(unfiltered, request);
      if (
        results.length >= request.topK ||
        response.length < candidateLimit ||
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

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
    for (const embedding of document.embeddings) {
      if (embedding.vector.length !== dimensions)
        throw new Error(`Vector dimension mismatch for document ${document.id}`);
      if (!embedding.vector.every(Number.isFinite))
        throw new Error(`Vector for document ${document.id} must contain only finite numbers`);
    }
  }
}

function metricName(metric: LanceDBVectorStoreOptions["metric"]): "cosine" | "l2" | "dot" {
  if (metric === "euclidean") return "l2";
  if (metric === "dotProduct") return "dot";
  return "cosine";
}

function validateSearchRequest(request: VectorSearchRequest, dimensions: number): void {
  throwIfAborted(request.abortSignal);
  if (!Number.isSafeInteger(request.topK) || request.topK < 1)
    throw new RangeError("Vector search topK must be a positive safe integer.");
  if (request.minScore !== undefined && !Number.isFinite(request.minScore))
    throw new RangeError("Vector search minScore must be a finite number.");
  if (request.vector.length !== dimensions) {
    throw new Error(
      `Vector dimension mismatch: expected ${dimensions} dimensions but received ${request.vector.length} for query`,
    );
  }
  if (!request.vector.every(Number.isFinite))
    throw new Error("Vector search query must contain only finite numbers");
}
