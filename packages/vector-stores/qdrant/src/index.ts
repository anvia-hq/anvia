import { createHash } from "node:crypto";
import {
  createVectorSearchTool,
  type EmbeddedDocument,
  type EmbeddingModel,
  embedText,
  type Tool,
  type VectorFilter,
  type VectorMetadata,
  type VectorSearchIndex,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorSearchToolOptions,
} from "@anvia/core";

const documentIdPayloadKey = "__anvia_document_id";
const documentPayloadKey = "__anvia_document";
const reservedPayloadPrefix = "__anvia_";

export type QdrantDistance = "Cosine" | "Dot" | "Euclid";

type QdrantClientLike = {
  getCollection(collectionName: string): Promise<unknown>;
  createCollection(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  upsert(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
  search(collectionName: string, options: Record<string, unknown>): Promise<unknown>;
};

export type QdrantVectorStoreConnectOptions = {
  client?: QdrantClientLike | undefined;
  collectionName: string;
  vectorSize: number;
  createIfMissing?: boolean | undefined;
  distance?: QdrantDistance | undefined;
};

export class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreConnectOptions,
  ): Promise<QdrantVectorStore<T, Metadata>> {
    const client = options.client ?? (await defaultQdrantClient());
    if (options.createIfMissing === false) {
      await client.getCollection(options.collectionName);
      return new QdrantVectorStore<T, Metadata>(client, options.collectionName);
    }

    try {
      await client.getCollection(options.collectionName);
    } catch {
      await client.createCollection(options.collectionName, {
        vectors: {
          size: options.vectorSize,
          distance: options.distance ?? "Cosine",
        },
      });
    }
    return new QdrantVectorStore<T, Metadata>(client, options.collectionName);
  }

  async upsertDocuments(documents: Array<EmbeddedDocument<T, Metadata>>): Promise<void> {
    const points = documents.flatMap((document) => qdrantPoints(document));
    await this.client.upsert(this.collectionName, { points });
  }

  index(model: EmbeddingModel): QdrantVectorIndex<T, Metadata> {
    return new QdrantVectorIndex(model, this.client, this.collectionName);
  }
}

export class QdrantVectorIndex<T, Metadata extends VectorMetadata = VectorMetadata>
  implements VectorSearchIndex<T, Metadata>
{
  constructor(
    private readonly model: EmbeddingModel,
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
  ) {}

  async search(request: VectorSearchRequest): Promise<Array<VectorSearchResult<T, Metadata>>> {
    const queryEmbedding = await embedText(this.model, request.query);
    const response = await this.client.search(this.collectionName, {
      vector: queryEmbedding.vector,
      limit: request.topK,
      filter: filterToQdrantFilter(request.filter),
      with_payload: true,
    });
    return parseQueryResults<T, Metadata>(response, request.threshold);
  }

  async searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return (await this.search(request)).map(({ score, id }) => ({ score, id }));
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return createVectorSearchTool(this, options);
  }
}

export function filterToQdrantFilter(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { must: [{ key: filter.key, match: { value: filter.value } }] };
    case "gt":
      return { must: [{ key: filter.key, range: { gt: filter.value } }] };
    case "lt":
      return { must: [{ key: filter.key, range: { lt: filter.value } }] };
    case "and":
      return { must: filter.filters.map(filterToQdrantFilter) };
    case "or":
      return { should: filter.filters.map(filterToQdrantFilter) };
  }
}

async function defaultQdrantClient(): Promise<QdrantClientLike> {
  const qdrant = await import("@qdrant/js-client-rest");
  return new qdrant.QdrantClient({}) as QdrantClientLike;
}

function qdrantPoints<T, Metadata extends VectorMetadata>(
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
    return {
      id: pointId(logicalId),
      vector: embedding.vector,
      payload: {
        [documentIdPayloadKey]: document.id,
        [documentPayloadKey]: serializeDocument(document.document),
        ...(document.metadata ?? {}),
      },
    };
  });
}

function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedPayloadPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Qdrant payloads`);
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

function serializeDocument(document: unknown): string {
  return typeof document === "string" ? document : JSON.stringify(document);
}

function parseQueryResults<T, Metadata extends VectorMetadata>(
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
    const result = {
      id,
      score: point.score,
      document: parseDocument(point.payload?.[documentPayloadKey]),
      ...metadataFromPayload<Metadata>(point.payload),
    } as VectorSearchResult<T, Metadata>;
    const current = byId.get(id);
    if (current === undefined || result.score > current.score) {
      byId.set(id, result);
    }
  }

  return [...byId.values()];
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
  return (points ?? []).map((point) => ({
    id: point.id,
    score: point.score ?? 0,
    ...(point.payload === undefined ? {} : { payload: point.payload }),
  }));
}

function parseDocument<T>(document: unknown): T {
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

function metadataFromPayload<Metadata extends VectorMetadata>(
  payload: Record<string, unknown> | null | undefined,
): { metadata?: Metadata | undefined } {
  const metadata = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => !key.startsWith(reservedPayloadPrefix)),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}
