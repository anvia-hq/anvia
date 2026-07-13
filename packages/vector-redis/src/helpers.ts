import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import {
  documentField,
  documentIdField,
  type RedisClientLike,
  reservedFieldPrefix,
  vectorField,
} from "./types.js";

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedFieldPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Redis fields`);
    }
  }
}

export function redisKeyId(keyPrefix: string, id: string): string {
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return `${keyPrefix}${hash}`;
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

export function redisHashEntries<T, Metadata extends VectorMetadata>(
  keyPrefix: string,
  document: EmbeddedDocument<T, Metadata>,
): Array<{ key: string; fields: Record<string, unknown> }> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const fields: Record<string, unknown> = {
      [documentIdField]: document.id,
      [documentField]: serializeDocument(document.document),
      [vectorField]: Buffer.from(new Float32Array(embedding.vector).buffer),
    };
    Object.assign(fields, document.metadata);
    return {
      key: redisKeyId(keyPrefix, logicalId),
      fields,
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const raw = response as {
    total?: number;
    documents?: Array<{
      id?: string;
      value?: Record<string, unknown>;
    }>;
  };
  const documents = raw.documents ?? [];
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const doc of documents) {
    const value = doc.value ?? {};
    const scoreRaw = value.score ?? value.__vector_score;
    const score = typeof scoreRaw === "string" ? parseFloat(scoreRaw) : ((scoreRaw as number) ?? 0);

    if (threshold !== undefined && score < threshold) {
      continue;
    }

    const id = String(value[documentIdField] ?? "");
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
      document: parseDocument(value[documentField]),
    };
    const metadata = metadataFromFields<Metadata>(value);
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

export async function defaultRedisClient(): Promise<RedisClientLike> {
  const redis = await import("redis");
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = redis.createClient({ url });
  await client.connect();
  return client as unknown as RedisClientLike;
}

function metadataFromFields<Metadata extends VectorMetadata>(
  fields: Record<string, unknown>,
): Metadata | undefined {
  const metadata = Object.fromEntries(
    Object.entries(fields).filter(
      ([key]) =>
        !key.startsWith(reservedFieldPrefix) &&
        key !== vectorField &&
        key !== "score" &&
        key !== "__vector_score",
    ),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
