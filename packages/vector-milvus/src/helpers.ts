import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import {
  documentFieldName,
  documentIdFieldName,
  type MilvusClientLike,
  type MilvusMetric,
  reservedFieldPrefix,
} from "./types.js";

export function pointId(id: string): string {
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

export function assertNoReservedFields(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedFieldPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Milvus fields`);
    }
  }
}

export function milvusRows<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<Record<string, unknown>> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }

  assertNoReservedFields(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const row: Record<string, unknown> = {
      id: pointId(logicalId),
      [documentIdFieldName]: document.id,
      [documentFieldName]: serializeDocument(document.document),
      vector: embedding.vector,
    };
    Object.assign(row, document.metadata);
    return row;
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  minScore: number | undefined,
  metric: MilvusMetric,
): Array<VectorSearchResult<T, Metadata>> {
  const matches = milvusMatches(response);

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const match of matches) {
    const rawScore = match.score ?? 0;
    const score = metric === "L2" ? -rawScore : rawScore;
    if (minScore !== undefined && score < minScore) {
      continue;
    }

    const id = String(match[documentIdFieldName] ?? match.id);
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
      document: parseDocument(match[documentFieldName]),
    };
    const metadata = metadataFromRow<Metadata>(match);
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

export function milvusResultCount(response: unknown): number {
  return milvusMatches(response).length;
}

type MilvusMatch = {
  id: string;
  score?: number;
  [documentIdFieldName]?: string;
  [documentFieldName]?: string;
  [key: string]: unknown;
};

function milvusMatches(response: unknown): MilvusMatch[] {
  const results = (response as { results?: Array<MilvusMatch | MilvusMatch[]> }).results ?? [];
  const first = results[0];
  return Array.isArray(first) ? first : (results as MilvusMatch[]);
}

export async function ensureCollection(
  client: MilvusClientLike,
  collectionName: string,
  vectorSize: number,
  metric: MilvusMetric,
): Promise<void> {
  const { value: exists } = await client.hasCollection({ collection_name: collectionName });
  if (exists) {
    return;
  }

  await client.createCollection({
    collection_name: collectionName,
    enable_dynamic_field: true,
    fields: [
      { name: "id", data_type: "VarChar", max_length: 64, is_primary_key: true },
      { name: documentIdFieldName, data_type: "VarChar", max_length: 4096 },
      { name: documentFieldName, data_type: "VarChar", max_length: 65535 },
      { name: "vector", data_type: "FloatVector", dim: vectorSize },
    ],
    metric_type: metric,
  });

  await client.createIndex({
    collection_name: collectionName,
    field_name: "vector",
    index_type: "HNSW",
    metric_type: metric,
    params: { M: 16, efConstruction: 256 },
  });
}

export function validateMilvusCollection(
  response: unknown,
  collectionName: string,
  dimensions: number,
): void {
  const schema = (response as { schema?: { fields?: unknown[] } }).schema;
  if (schema?.fields === undefined) return;
  const vector = schema.fields.find(
    (
      field,
    ): field is {
      name?: string;
      dim?: unknown;
      type_params?: Array<{ key?: string; value?: unknown }>;
    } =>
      typeof field === "object" &&
      field !== null &&
      (field as { name?: unknown }).name === "vector",
  );
  if (vector === undefined) {
    throw new Error(`Milvus collection ${collectionName} is missing its vector field`);
  }
  const rawDimensions =
    vector.dim ?? vector.type_params?.find((parameter) => parameter.key === "dim")?.value;
  if (rawDimensions !== undefined && Number(rawDimensions) !== dimensions) {
    throw new Error(
      `Milvus collection ${collectionName} has ${String(rawDimensions)} dimensions; expected ${dimensions}`,
    );
  }
}

function metadataFromRow<Metadata extends VectorMetadata>(
  row: Record<string, unknown>,
): Metadata | undefined {
  const skipKeys = new Set(["id", "score", documentIdFieldName, documentFieldName, "vector"]);
  const metadata = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !skipKeys.has(key) && !key.startsWith(reservedFieldPrefix),
    ),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
