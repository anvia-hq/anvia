import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import type { PgClientLike, PgVectorDistance } from "./types.js";
import { reservedMetadataPrefix } from "./types.js";

export function pointId(id: string): string {
  const hex = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function pgVectorRows<T, Metadata extends VectorMetadata>(
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

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedMetadataPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia pgvector metadata`);
    }
  }
}

export function distanceOperator(distance: PgVectorDistance): "<=>" | "<->" | "<#>" {
  switch (distance) {
    case "cosine":
      return "<=>";
    case "l2":
      return "<->";
    case "innerProduct":
      return "<#>";
  }
}

export function scoreFromDistance(distance: number, strategy: PgVectorDistance): number {
  return strategy === "cosine" ? 1 - distance : -distance;
}

export function parseSearchRows<T, Metadata extends VectorMetadata>(
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
    const result: VectorSearchResult<T, Metadata> = {
      id: row.document_id,
      score,
      document: row.document as T,
    };
    if (row.metadata !== null) {
      result.metadata = row.metadata;
    }
    const current = byId.get(result.id);
    if (current === undefined || result.score > current.score) {
      byId.set(result.id, result);
    }
  }

  return [...byId.values()];
}

export function normalizedTopK(topK: number): number {
  return Math.max(0, Math.trunc(topK));
}

export function quoteQualifiedIdentifier(identifier: string): string {
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

export async function validateTable(
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

export async function defaultPgClient(connectionString: string | undefined): Promise<PgClientLike> {
  const pg = await import("pg");
  const options: { connectionString?: string } = {};
  if (connectionString !== undefined) {
    options.connectionString = connectionString;
  }
  return new pg.Pool(options) as PgClientLike;
}
