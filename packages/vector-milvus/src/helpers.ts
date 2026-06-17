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
    return {
      id: pointId(logicalId),
      [documentIdFieldName]: document.id,
      [documentFieldName]: serializeDocument(document.document),
      vector: embedding.vector,
      ...(document.metadata ?? {}),
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const raw = response as {
    results?: Array<
      Array<{
        id: string;
        score?: number;
        [documentIdFieldName]?: string;
        [documentFieldName]?: string;
        [key: string]: unknown;
      }>
    >;
  };
  const matches = raw.results?.[0] ?? [];

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const match of matches) {
    const score = match.score ?? 0;
    if (threshold !== undefined && score < threshold) {
      continue;
    }

    const id = String(match[documentIdFieldName] ?? match.id);
    const result = {
      id,
      score,
      document: parseDocument(match[documentFieldName]),
      ...metadataFromRow<Metadata>(match),
    } as VectorSearchResult<T, Metadata>;

    const current = byId.get(id);
    if (current === undefined || result.score > current.score) {
      byId.set(id, result);
    }
  }

  return [...byId.values()];
}

export async function defaultMilvusClient(): Promise<MilvusClientLike> {
  const { MilvusClient } = await import("@zilliz/milvus2-sdk-node");
  return new MilvusClient({ address: "localhost:19530" }) as unknown as MilvusClientLike;
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

function metadataFromRow<Metadata extends VectorMetadata>(
  row: Record<string, unknown>,
): { metadata?: Metadata | undefined } {
  const skipKeys = new Set(["id", "score", documentIdFieldName, documentFieldName, "vector"]);
  const metadata = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !skipKeys.has(key) && !key.startsWith(reservedFieldPrefix),
    ),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}
