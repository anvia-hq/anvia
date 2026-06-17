import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import {
  documentIdMetadataKey,
  documentMetadataKey,
  type PineconeClientLike,
  type PineconeMetric,
  reservedMetadataPrefix,
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

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedMetadataPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Pinecone payloads`);
    }
  }
}

export function pineconeVectors<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<Record<string, unknown>> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }

  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    return {
      id: pointId(logicalId),
      values: embedding.vector,
      metadata: {
        [documentIdMetadataKey]: document.id,
        [documentMetadataKey]: serializeDocument(document.document),
        ...(document.metadata ?? {}),
      },
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const raw = response as {
    matches?: Array<{
      id: string;
      score?: number;
      metadata?: Record<string, unknown> | null;
    }>;
  };
  const matches = raw.matches ?? [];

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const match of matches) {
    const score = match.score ?? 0;
    if (threshold !== undefined && score < threshold) {
      continue;
    }

    const id = String(match.metadata?.[documentIdMetadataKey] ?? match.id);
    const result = {
      id,
      score,
      document: parseDocument(match.metadata?.[documentMetadataKey]),
      ...metadataFromPayload<Metadata>(match.metadata),
    } as VectorSearchResult<T, Metadata>;

    const current = byId.get(id);
    if (current === undefined || result.score > current.score) {
      byId.set(id, result);
    }
  }

  return [...byId.values()];
}

export async function defaultPineconeClient(): Promise<PineconeClientLike> {
  const { Pinecone } = await import("@pinecone-database/pinecone");
  return new Pinecone() as unknown as PineconeClientLike;
}

export async function ensureIndex(
  client: PineconeClientLike,
  indexName: string,
  metric: PineconeMetric,
): Promise<void> {
  try {
    await client.listIndexes();
  } catch {
    return;
  }

  try {
    await client.createIndex({
      name: indexName,
      dimension: undefined,
      metric,
      spec: { serverless: { cloud: "aws", region: "us-east-1" } },
      waitUntilReady: true,
    });
  } catch {
    // Index already exists
  }
}

function metadataFromPayload<Metadata extends VectorMetadata>(
  payload: Record<string, unknown> | null | undefined,
): { metadata?: Metadata | undefined } {
  const metadata = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => !key.startsWith(reservedMetadataPrefix)),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}
