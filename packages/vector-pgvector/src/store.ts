import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore,
  VectorStoreUpsertOptions,
} from "@anvia/core/vector-store";
import pgvector from "pgvector";
import type { PgVectorClient } from "./client.js";
import { filterToPgVectorWhere } from "./filters.js";
import {
  distanceOperator,
  parseSearchRows,
  pgVectorRows,
  quoteQualifiedIdentifier,
  validateTable,
} from "./helpers.js";
import type { PgVectorDistance, PgVectorStoreOptions } from "./types.js";

export class PgVectorStore<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorStore<T, Metadata>
{
  private readonly tableName: string;
  private readonly distance: PgVectorDistance;
  constructor(
    private readonly owner: PgVectorClient,
    readonly options: PgVectorStoreOptions,
  ) {
    assertDimensions(options.dimensions);
    this.tableName = quoteQualifiedIdentifier(options.tableName);
    this.distance = distanceName(options.metric);
  }
  async ensure(): Promise<void> {
    const client = await this.owner.nativeClient();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      document JSONB NOT NULL,
      metadata JSONB,
      embedding vector(${this.options.dimensions}) NOT NULL
    )`);
    await this.validate();
  }
  async validate(): Promise<void> {
    await validateTable(await this.owner.nativeClient(), this.tableName, this.options.dimensions);
  }
  async upsert(options: VectorStoreUpsertOptions<T, Metadata>): Promise<void> {
    validateDocuments(options.documents, this.options.dimensions);
    if (options.documents.length === 0) return;
    const client = await this.owner.nativeClient();
    const documentIds = options.documents.map((document) => document.id);
    await queryWithProviderOptions(
      client,
      `DELETE FROM ${this.tableName} WHERE document_id = ANY($1::text[])`,
      [documentIds],
      options.providerOptions,
    );
    const rows = options.documents.flatMap((document) => pgVectorRows(document));
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders = rows.map((row, index) => {
      const offset = index * 5;
      values.push(
        row.id,
        row.documentId,
        JSON.stringify(row.document),
        row.metadata === undefined ? null : JSON.stringify(row.metadata),
        pgvector.toSql(row.embedding),
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4}::jsonb, $${offset + 5}::vector)`;
    });
    await queryWithProviderOptions(
      client,
      `INSERT INTO ${this.tableName} (id, document_id, document, metadata, embedding)
VALUES ${placeholders.join(", ")}
ON CONFLICT (id) DO UPDATE SET document_id = EXCLUDED.document_id, document = EXCLUDED.document, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
      values,
      options.providerOptions,
    );
  }
  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    validateSearchRequest(request, this.options.dimensions);
    const operator = distanceOperator(this.distance);
    const where = filterToPgVectorWhere(request.filter, 2);
    const limitParameter = 2 + (where?.values.length ?? 0);
    const client = await this.owner.nativeClient();
    let candidateLimit = request.topK;
    for (;;) {
      const response = await queryWithProviderOptions(
        client,
        `SELECT id, document_id, document, metadata, embedding ${operator} $1::vector AS distance
FROM ${this.tableName}
${where === undefined ? "" : `WHERE ${where.sql}`}
ORDER BY embedding ${operator} $1::vector
LIMIT $${limitParameter}`,
        [pgvector.toSql(request.vector), ...(where?.values ?? []), candidateLimit],
        request.providerOptions,
      );
      throwIfAborted(request.abortSignal);
      const rows = response.rows as Array<{
        id: string;
        document_id: string;
        document: unknown;
        metadata: Metadata | null;
        distance: number | string;
      }>;
      const unfiltered = parseSearchRows<T, Metadata>(rows, undefined, this.distance);
      const results = selectResults(unfiltered, request);
      if (
        results.length >= request.topK ||
        rows.length < candidateLimit ||
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
function distanceName(metric: PgVectorStoreOptions["metric"]): PgVectorDistance {
  if (metric === "euclidean") return "l2";
  if (metric === "dotProduct") return "innerProduct";
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

async function queryWithProviderOptions(
  client: Awaited<ReturnType<PgVectorClient["nativeClient"]>>,
  text: string,
  values: readonly unknown[],
  providerOptions: Record<string, unknown> | undefined,
): Promise<{ rows: Record<string, unknown>[] }> {
  return providerOptions === undefined
    ? client.query(text, values)
    : client.query({ ...providerOptions, text, values });
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
