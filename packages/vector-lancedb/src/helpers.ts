import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import { documentColumn, documentIdColumn, reservedColumnPrefix, vectorColumn } from "./types.js";

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedColumnPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia LanceDB columns`);
    }
  }
}

export function rowId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}

export function serializeDocument(document: unknown): string {
  return typeof document === "string" ? document : JSON.stringify(document);
}

export function parseDocument<T>(document: unknown): T {
  if (document === null || document === undefined) {
    return "" as T;
  }
  if (typeof document !== "string") {
    return document as T;
  }
  try {
    return JSON.parse(document) as T;
  } catch {
    return document as T;
  }
}

export function lanceRows<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<Record<string, unknown>> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const row: Record<string, unknown> = {
      _rowid: rowId(logicalId),
      [documentIdColumn]: document.id,
      [documentColumn]: serializeDocument(document.document),
      [vectorColumn]: embedding.vector,
    };
    Object.assign(row, document.metadata);
    return row;
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown[],
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const row of response) {
    const record = row as Record<string, unknown>;
    const distance = typeof record._distance === "number" ? record._distance : 0;
    const score = 1 - distance;

    if (threshold !== undefined && score < threshold) {
      continue;
    }

    const id = String(record[documentIdColumn] ?? "");
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
      document: parseDocument(record[documentColumn]),
    };
    const metadata = metadataFromColumns<Metadata>(record);
    if (metadata !== undefined) {
      result.metadata = metadata;
    }
    const current = byId.get(id);
    if (current === undefined || result.score > current.score) {
      byId.set(id, result);
    }
  }

  return [...byId.values()];
}

export async function defaultLanceDBConnection(
  uri?: string,
): Promise<import("./types.js").LanceDBConnectionLike> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(
    uri ?? "~/.anvia/lancedb",
  ) as unknown as import("./types.js").LanceDBConnectionLike;
}

function metadataFromColumns<Metadata extends VectorMetadata>(
  record: Record<string, unknown>,
): Metadata | undefined {
  const metadata = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        !key.startsWith(reservedColumnPrefix) &&
        key !== vectorColumn &&
        key !== "_rowid" &&
        key !== "_distance",
    ),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
