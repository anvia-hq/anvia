import { createHash } from "node:crypto";
import {
  createVectorSearchTool,
  type EmbeddedDocument,
  type EmbeddingModel,
  embedText,
  type Tool,
  type VectorFilter,
  type VectorMetadata,
  type VectorMetadataValue,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core";
import pgvector from "pgvector";

const reservedMetadataPrefix = "__anvia_";

export type PgVectorDistance = "cosine" | "l2" | "innerProduct";

export type PgVectorWhere = {
  sql: string;
  values: unknown[];
};

type PgClientLike = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type PgVectorStoreConnectOptions = {
  client?: PgClientLike | undefined;
  connectionString?: string | undefined;
  tableName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: PgVectorDistance | undefined;
};

export class PgVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: PgClientLike,
    private readonly tableName: string,
    private readonly distance: PgVectorDistance,
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: PgVectorStoreConnectOptions,
  ): Promise<PgVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultPgClient(options.connectionString));
    const tableName = quoteQualifiedIdentifier(options.tableName);
    const distance = options.distance ?? "cosine";

    if (options.createIfMissing !== false) {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (
  id text PRIMARY KEY,
  document_id text NOT NULL,
  document jsonb NOT NULL,
  metadata jsonb,
  embedding vector(${options.vectorSize}) NOT NULL
)`);
    }

    await validateTable(client, tableName, options.vectorSize);
    return new PgVectorStore<T, Metadata>(client, tableName, distance);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const rows = documents.flatMap((document) => pgVectorRows(document));
    if (rows.length === 0) {
      return;
    }

    const values = rows.flatMap((row) => [
      row.id,
      row.documentId,
      JSON.stringify(row.document),
      row.metadata === undefined ? null : JSON.stringify(row.metadata),
      pgvector.toSql(row.embedding),
    ]);
    const placeholders = rows.map((_, index) => {
      const offset = index * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4}::jsonb, $${
        offset + 5
      }::vector)`;
    });

    await this.client.query(
      `INSERT INTO ${this.tableName} (id, document_id, document, metadata, embedding)
VALUES ${placeholders.join(", ")}
ON CONFLICT (id) DO UPDATE SET
  document_id = EXCLUDED.document_id,
  document = EXCLUDED.document,
  metadata = EXCLUDED.metadata,
  embedding = EXCLUDED.embedding`,
      values,
    );
  }

  index(model: EmbeddingModel): PgVectorIndex<T, Metadata> {
    return new PgVectorIndex(model, this.client, this.tableName, this.distance);
  }
}

export class PgVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly client: PgClientLike,
    private readonly tableName: string,
    private readonly distance: PgVectorDistance,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    const operator = distanceOperator(this.distance);
    const where = filterToPgVectorWhere(request.filter, 2);
    const limitParameter = 2 + (where?.values.length ?? 0);
    const response = await this.client.query(
      `SELECT id, document_id, document, metadata, embedding ${operator} $1::vector AS distance
FROM ${this.tableName}
${where === undefined ? "" : `WHERE ${where.sql}`}
ORDER BY embedding ${operator} $1::vector
LIMIT $${limitParameter}`,
      [
        pgvector.toSql(queryEmbedding.vector),
        ...(where?.values ?? []),
        normalizedTopK(request.topK),
      ],
    );

    return parseSearchRows<T, Metadata>(
      response.rows as Array<{
        id: string;
        document_id: string;
        document: unknown;
        metadata: Metadata | null;
        distance: number | string;
      }>,
      request.threshold,
      this.distance,
    );
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}

export function filterToPgVectorWhere(
  filter: VectorFilter | undefined,
  startIndex = 1,
): PgVectorWhere | undefined {
  if (filter === undefined) {
    return undefined;
  }
  const state = { nextIndex: startIndex };
  const sql = buildFilterSql(filter, state);
  return { sql, values: stateValues(filter) };
}

async function defaultPgClient(connectionString: string | undefined): Promise<PgClientLike> {
  const pg = await import("pg");
  return new pg.Pool(connectionString === undefined ? {} : { connectionString }) as PgClientLike;
}

async function validateTable(
  client: PgClientLike,
  tableName: string,
  vectorSize: number,
): Promise<void> {
  const result = await client.query(
    `SELECT a.atttypmod AS vector_size
FROM pg_attribute a
WHERE a.attrelid = $1::regclass
  AND a.attname = 'embedding'
  AND NOT a.attisdropped`,
    [tableName],
  );
  const rawSize = result.rows[0]?.vector_size;
  if (rawSize === undefined) {
    throw new Error(`PgVector table ${tableName} is missing an embedding vector column`);
  }
  const actualSize = Number(rawSize);
  if (actualSize !== vectorSize) {
    throw new Error(
      `PgVector table ${tableName} has vector size ${actualSize}; expected ${vectorSize}`,
    );
  }
}

function distanceOperator(distance: PgVectorDistance): "<=>" | "<->" | "<#>" {
  switch (distance) {
    case "cosine":
      return "<=>";
    case "l2":
      return "<->";
    case "innerProduct":
      return "<#>";
  }
}

function scoreFromDistance(distance: number, strategy: PgVectorDistance): number {
  return strategy === "cosine" ? 1 - distance : -distance;
}

function parseSearchRows<T, Metadata extends VectorMetadata>(
  rows: Array<{
    id: string;
    document_id: string;
    document: unknown;
    metadata: Metadata | null;
    distance: number | string;
  }>,
  threshold: number | undefined,
  distanceStrategy: PgVectorDistance,
): Array<VectorSearchResult<T, Metadata>> {
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const row of rows) {
    const score = scoreFromDistance(Number(row.distance), distanceStrategy);
    if (threshold !== undefined && score < threshold) {
      continue;
    }
    const result = {
      id: row.document_id,
      score,
      document: row.document as T,
      ...(row.metadata === null ? {} : { metadata: row.metadata }),
    } as VectorSearchResult<T, Metadata>;
    const current = byId.get(result.id);
    if (current === undefined || result.score > current.score) {
      byId.set(result.id, result);
    }
  }

  return [...byId.values()];
}

function pgVectorRows<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<{
  id: string;
  documentId: string;
  document: T;
  metadata: Metadata | undefined;
  embedding: number[];
}> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    return {
      id: pointId(logicalId),
      documentId: document.id,
      document: document.document,
      metadata: document.metadata,
      embedding: embedding.vector,
    };
  });
}

function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedMetadataPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia pgvector metadata`);
    }
  }
}

function pointId(id: string): string {
  const hex = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function quoteQualifiedIdentifier(identifier: string): string {
  const parts = identifier.split(".");
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return parts.map(quoteIdentifier).join(".");
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizedTopK(topK: number): number {
  return Math.max(0, Math.trunc(topK));
}

function buildFilterSql(filter: VectorFilter, state: { nextIndex: number }): string {
  switch (filter.type) {
    case "eq": {
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex}) = $${valueIndex}`;
    }
    case "gt": {
      assertNumericFilterValue(filter.value, filter.type);
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex})::numeric > $${valueIndex}`;
    }
    case "lt": {
      assertNumericFilterValue(filter.value, filter.type);
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex})::numeric < $${valueIndex}`;
    }
    case "and":
      return `(${buildFilterSql(filter.filters[0], state)} AND ${buildFilterSql(
        filter.filters[1],
        state,
      )})`;
    case "or":
      return `(${buildFilterSql(filter.filters[0], state)} OR ${buildFilterSql(
        filter.filters[1],
        state,
      )})`;
  }
}

function stateValues(filter: VectorFilter): unknown[] {
  switch (filter.type) {
    case "eq":
      return [filter.key, serializeMetadataValue(filter.value)];
    case "gt":
    case "lt":
      assertNumericFilterValue(filter.value, filter.type);
      return [filter.key, filter.value];
    case "and":
    case "or":
      return [...stateValues(filter.filters[0]), ...stateValues(filter.filters[1])];
  }
}

function serializeMetadataValue(value: VectorMetadataValue): string | null {
  return value === null ? null : String(value);
}

function assertNumericFilterValue(value: VectorMetadataValue, operator: "gt" | "lt"): void {
  if (typeof value !== "number") {
    throw new Error(`PgVector ${operator} filters require numeric metadata values`);
  }
}
