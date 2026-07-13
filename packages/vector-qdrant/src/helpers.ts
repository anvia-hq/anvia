import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import {
  documentIdPayloadKey,
  documentPayloadKey,
  type QdrantClientLike,
  reservedPayloadPrefix,
} from "./types.js";

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedPayloadPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Qdrant payloads`);
    }
  }
}

export function pointId(id: string): string {
  const hex = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
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

export function qdrantPoints<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<{
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const payload: Record<string, unknown> = {
      [documentIdPayloadKey]: document.id,
      [documentPayloadKey]: serializeDocument(document.document),
    };
    Object.assign(payload, document.metadata);
    return {
      id: pointId(logicalId),
      vector: embedding.vector,
      payload,
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const points = rawPoints(response);
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const point of points) {
    if (threshold !== undefined && point.score < threshold) {
      continue;
    }

    const id = String(point.payload?.[documentIdPayloadKey] ?? point.id);
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score: point.score,
      document: parseDocument(point.payload?.[documentPayloadKey]),
    };
    const metadata = metadataFromPayload<Metadata>(point.payload);
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

export async function defaultQdrantClient(): Promise<QdrantClientLike> {
  const qdrant = await import("@qdrant/js-client-rest");
  return new qdrant.QdrantClient({}) as QdrantClientLike;
}

function rawPoints(response: unknown): Array<{
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}> {
  const raw = response as {
    points?: Array<{
      id: string | number;
      score?: number;
      payload?: Record<string, unknown> | null;
    }>;
    result?:
      | {
          points?: Array<{
            id: string | number;
            score?: number;
            payload?: Record<string, unknown> | null;
          }>;
        }
      | Array<{ id: string | number; score?: number; payload?: Record<string, unknown> | null }>;
  };
  const responseArray = Array.isArray(response)
    ? (response as Array<{
        id: string | number;
        score?: number;
        payload?: Record<string, unknown> | null;
      }>)
    : undefined;
  const points =
    responseArray ??
    (Array.isArray(raw.result)
      ? raw.result
      : Array.isArray(raw.result?.points)
        ? raw.result.points
        : raw.points);
  return (points ?? []).map((point) => {
    const result: {
      id: string | number;
      score: number;
      payload?: Record<string, unknown> | null;
    } = {
      id: point.id,
      score: point.score ?? 0,
    };
    if (point.payload !== undefined) {
      result.payload = point.payload;
    }
    return result;
  });
}

function metadataFromPayload<Metadata extends VectorMetadata>(
  payload: Record<string, unknown> | null | undefined,
): Metadata | undefined {
  const metadata = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => !key.startsWith(reservedPayloadPrefix)),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
