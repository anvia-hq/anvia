import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type {
  VectorInspectItem,
  VectorInspectPage,
  VectorSearchResult,
} from "@anvia/core/vector-store";
import type { QdrantClientParams } from "@qdrant/js-client-rest";
import {
  defaultDenseVectorName,
  defaultSparseVectorName,
  documentIdPayloadKey,
  documentPayloadKey,
  namespacePayloadKey,
  type QdrantClientLike,
  type QdrantDistance,
  type QdrantMutationOptions,
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
  options: {
    hybrid?: boolean | undefined;
    denseVectorName?: string | undefined;
    sparseVectorName?: string | undefined;
    namespace?: string | undefined;
  } = {},
): Array<{
  id: string;
  vector: number[] | Record<string, unknown>;
  payload: Record<string, unknown>;
}> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  const hybrid = options.hybrid === true;
  if (hybrid) {
    const sparseEmbeddings = document.sparseEmbeddings;
    if (sparseEmbeddings === undefined || sparseEmbeddings.length !== document.embeddings.length) {
      throw new Error(
        `Hybrid Qdrant upsert requires sparseEmbeddings aligned with embeddings for document ${document.id}`,
      );
    }
  }

  const denseName = options.denseVectorName ?? defaultDenseVectorName;
  const sparseName = options.sparseVectorName ?? defaultSparseVectorName;

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const payload: Record<string, unknown> = {
      [documentIdPayloadKey]: document.id,
      [documentPayloadKey]: serializeDocument(document.document),
    };
    if (options.namespace !== undefined) payload[namespacePayloadKey] = options.namespace;
    Object.assign(payload, document.metadata);

    if (!hybrid) {
      return {
        id: pointId(scopedLogicalId(logicalId, options.namespace)),
        vector: embedding.vector,
        payload,
      };
    }

    const sparse = document.sparseEmbeddings?.[index];
    if (sparse === undefined) {
      throw new Error(
        `Hybrid Qdrant upsert requires sparseEmbeddings aligned with embeddings for document ${document.id}`,
      );
    }
    return {
      id: pointId(scopedLogicalId(logicalId, options.namespace)),
      vector: {
        [denseName]: embedding.vector,
        [sparseName]: {
          indices: sparse.vector.indices,
          values: sparse.vector.values,
        },
      },
      payload,
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  minScore: number | undefined,
  metric?: QdrantDistance | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const points = rawPoints(response);
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const point of points) {
    const score = metric === "Euclid" ? -point.score : point.score;
    if (minScore !== undefined && score < minScore) {
      continue;
    }

    const id = String(point.payload?.[documentIdPayloadKey] ?? point.id);
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
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

export function qdrantResultCount(response: unknown): number {
  return rawPoints(response).length;
}

export async function qdrantDocumentPage<T, Metadata extends VectorMetadata>(
  client: QdrantClientLike,
  collectionName: string,
  options: {
    limit: number;
    cursor?: string | undefined;
    filter?: unknown;
    providerOptions?: Record<string, unknown> | undefined;
  },
): Promise<VectorInspectPage<T, Metadata>> {
  if (typeof client.scroll !== "function") {
    throw new TypeError(
      "Qdrant document inspection requires a client that implements scroll(...).",
    );
  }

  const limit = Math.max(0, Math.trunc(options.limit));
  const cursor = parseInspectCursor(options.cursor);
  if (limit === 0) {
    return { items: [] };
  }

  const seenDocumentIds = new Set(cursor.documentIds);
  const seenOffsets = new Set<string | number>();
  if (cursor.offset !== undefined) {
    seenOffsets.add(cursor.offset);
  }
  const items: Array<VectorInspectItem<T, Metadata>> = [];
  let offset = cursor.offset;
  let skip = cursor.skip;

  while (true) {
    const response = await client.scroll(collectionName, {
      ...options.providerOptions,
      filter: options.filter,
      limit: Math.max(100, limit * 2),
      offset,
      with_payload: true,
      with_vector: false,
    });
    const page = rawScrollPage(response);

    for (let index = skip; index < page.points.length; index += 1) {
      const point = page.points[index];
      if (point === undefined) {
        continue;
      }
      const item = inspectItemFromPoint<T, Metadata>(point);
      if (seenDocumentIds.has(item.id)) {
        continue;
      }
      if (items.length === limit) {
        return {
          items,
          nextCursor: serializeInspectCursor({
            offset,
            skip: index,
            documentIds: [...seenDocumentIds],
          }),
        };
      }
      seenDocumentIds.add(item.id);
      items.push(item);
    }

    if (
      page.nextOffset === undefined ||
      page.points.length === 0 ||
      seenOffsets.has(page.nextOffset)
    ) {
      break;
    }
    seenOffsets.add(page.nextOffset);
    offset = page.nextOffset;
    skip = 0;
  }

  return { items };
}

export function qdrantMutationRequest(
  options: QdrantMutationOptions = {},
): Record<string, unknown> {
  const request: Record<string, unknown> = { wait: options.wait ?? true };
  if (options.ordering !== undefined) {
    request.ordering = options.ordering;
  }
  if (options.timeout !== undefined) {
    request.timeout = options.timeout;
  }
  return request;
}

export function qdrantDocumentFilter(
  documentIds: string[],
  namespace?: string | undefined,
): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [
    {
      key: documentIdPayloadKey,
      match: { any: documentIds },
    },
  ];
  if (namespace !== undefined) must.push(namespaceCondition(namespace));
  return {
    must,
  };
}

export function qdrantScopedFilter(namespace: string | undefined, filter: unknown): unknown {
  if (namespace === undefined) return filter;
  const condition = namespaceCondition(namespace);
  return filter === undefined ? { must: [condition] } : { must: [condition, filter] };
}

function namespaceCondition(namespace: string): Record<string, unknown> {
  return { key: namespacePayloadKey, match: { value: namespace } };
}

function scopedLogicalId(logicalId: string, namespace: string | undefined): string {
  return namespace === undefined ? logicalId : `${namespace}\u0000${logicalId}`;
}

export function validateQdrantCollection(
  response: unknown,
  options: {
    vectorSize: number;
    distance: QdrantDistance;
    hybrid: boolean;
    denseVectorName: string;
    sparseVectorName: string;
  },
): void {
  const info = unwrapResult(response);
  const config = recordValue(info, "config");
  const params = recordValue(config, "params");
  const vectors = recordValue(params, "vectors");
  if (vectors === undefined) {
    // Keep lightweight custom clients compatible when they do not return collection configuration.
    return;
  }

  const denseVector = options.hybrid
    ? recordValue(vectors, options.denseVectorName)
    : typeof vectors.size === "number"
      ? vectors
      : undefined;
  if (denseVector === undefined) {
    throw new Error(
      options.hybrid
        ? `Qdrant collection is missing dense vector ${options.denseVectorName}`
        : "Qdrant collection uses named vectors but a dense-only collection was requested",
    );
  }

  const actualSize = denseVector.size;
  if (typeof actualSize === "number" && actualSize !== options.vectorSize) {
    throw new Error(
      `Qdrant collection vector size ${actualSize} does not match requested size ${options.vectorSize}`,
    );
  }
  const actualDistance = denseVector.distance;
  if (typeof actualDistance === "string" && actualDistance !== options.distance) {
    throw new Error(
      `Qdrant collection distance ${actualDistance} does not match requested distance ${options.distance}`,
    );
  }

  const sparseVectors = recordValue(params, "sparse_vectors");
  if (options.hybrid && recordValue(sparseVectors, options.sparseVectorName) === undefined) {
    throw new Error(`Qdrant collection is missing sparse vector ${options.sparseVectorName}`);
  }
  if (!options.hybrid && sparseVectors !== undefined && Object.keys(sparseVectors).length > 0) {
    throw new Error("Qdrant collection is hybrid but a dense-only collection was requested");
  }
}

export function qdrantCollectionExists(response: unknown): boolean | undefined {
  if (typeof response === "boolean") {
    return response;
  }
  const result = unwrapResult(response);
  return typeof result?.exists === "boolean" ? result.exists : undefined;
}

export function isQdrantNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown } | undefined;
    message?: unknown;
  };
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.response?.status === 404 ||
    (typeof candidate.message === "string" &&
      /(?:\b404\b|not found|missing collection)/i.test(candidate.message))
  );
}

export async function defaultQdrantClient(
  options: QdrantClientParams = {},
): Promise<QdrantClientLike> {
  const qdrant = await import("@qdrant/js-client-rest");
  return new qdrant.QdrantClient(options) as QdrantClientLike;
}

type QdrantInspectCursor = {
  offset?: string | number | undefined;
  skip: number;
  documentIds: string[];
};

function parseInspectCursor(cursor: string | undefined): QdrantInspectCursor {
  if (cursor === undefined) {
    return { skip: 0, documentIds: [] };
  }
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as Record<string, unknown>;
    const offset = value.offset;
    const skip = value.skip;
    const documentIds = value.documentIds;
    if (
      (offset !== undefined && typeof offset !== "string" && typeof offset !== "number") ||
      !Number.isSafeInteger(skip) ||
      (skip as number) < 0 ||
      !Array.isArray(documentIds) ||
      !documentIds.every((id) => typeof id === "string")
    ) {
      throw new TypeError("invalid cursor state");
    }
    return {
      offset: offset as string | number | undefined,
      skip: skip as number,
      documentIds: documentIds as string[],
    };
  } catch {
    throw new TypeError(`Invalid Qdrant inspect cursor: ${cursor}`);
  }
}

function serializeInspectCursor(cursor: QdrantInspectCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

function rawScrollPage(response: unknown): {
  points: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
  }>;
  nextOffset?: string | number;
} {
  const result = unwrapResult(response);
  const rawPoints = Array.isArray(result?.points) ? result.points : [];
  const page: {
    points: Array<{
      id: string | number;
      payload?: Record<string, unknown> | null;
    }>;
    nextOffset?: string | number;
  } = {
    points: rawPoints.flatMap((point) => {
      if (typeof point !== "object" || point === null || !("id" in point)) {
        return [];
      }
      const id = point.id;
      if (typeof id !== "string" && typeof id !== "number") {
        return [];
      }
      const parsed: { id: string | number; payload?: Record<string, unknown> | null } = { id };
      if ("payload" in point && (point.payload === null || typeof point.payload === "object")) {
        parsed.payload = point.payload as Record<string, unknown> | null;
      }
      return [parsed];
    }),
  };
  if (
    typeof result?.next_page_offset === "string" ||
    typeof result?.next_page_offset === "number"
  ) {
    page.nextOffset = result.next_page_offset;
  }
  return page;
}

function inspectItemFromPoint<T, Metadata extends VectorMetadata>(point: {
  id: string | number;
  payload?: Record<string, unknown> | null;
}): VectorInspectItem<T, Metadata> {
  const item: VectorInspectItem<T, Metadata> = {
    id: String(point.payload?.[documentIdPayloadKey] ?? point.id),
    document: parseDocument<T>(point.payload?.[documentPayloadKey]),
  };
  const metadata = metadataFromPayload<Metadata>(point.payload);
  if (metadata !== undefined) {
    item.metadata = metadata;
  }
  return item;
}

function unwrapResult(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result = record.result;
  return typeof result === "object" && result !== null
    ? (result as Record<string, unknown>)
    : record;
}

function recordValue(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return typeof nested === "object" && nested !== null
    ? (nested as Record<string, unknown>)
    : undefined;
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
