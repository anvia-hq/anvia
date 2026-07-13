import { createHash } from "node:crypto";
import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import { documentIdPropertyKey, documentPropertyKey, reservedPropertyPrefix } from "./types.js";

export function assertNoReservedMetadata(metadata: VectorMetadata | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith(reservedPropertyPrefix)) {
      throw new Error(`Metadata key ${key} is reserved for Anvia Weaviate properties`);
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

export function weaviateObjects<T, Metadata extends VectorMetadata>(
  className: string,
  document: EmbeddedDocument<T, Metadata>,
): Array<Record<string, unknown>> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }
  assertNoReservedMetadata(document.metadata);

  return document.embeddings.map((embedding, index) => {
    const logicalId =
      document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`;
    const properties: Record<string, unknown> = {
      [documentIdPropertyKey]: document.id,
      [documentPropertyKey]: serializeDocument(document.document),
    };
    Object.assign(properties, document.metadata);
    return {
      class: className,
      id: pointId(logicalId),
      vector: embedding.vector,
      properties,
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: Array<Record<string, unknown>>,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();

  for (const item of response) {
    const additional = item._additional as Record<string, unknown> | undefined;
    const certainty = additional?.certainty as number | undefined;
    const distance = additional?.distance as number | undefined;
    const score = certainty ?? (distance !== undefined ? 1 - distance : 0);

    if (threshold !== undefined && score < threshold) {
      continue;
    }

    const id = String(item[documentIdPropertyKey] ?? "");
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
      document: parseDocument(item[documentPropertyKey]),
    };
    const metadata = metadataFromProperties<Metadata>(item);
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

export async function defaultWeaviateClient(): Promise<import("./types.js").WeaviateClientLike> {
  const weaviate = await import("weaviate-client");
  const defaultExport = weaviate.default ?? weaviate;
  const host = process.env.WEAVIATE_HOST ?? "localhost:8080";
  const grpcHost = process.env.WEAVIATE_GRPC_HOST ?? "localhost:50051";
  const client = await defaultExport.connectToCustom({
    httpHost: host,
    httpSecure: false,
    grpcHost: grpcHost,
    grpcSecure: false,
  });
  return client as unknown as import("./types.js").WeaviateClientLike;
}

function metadataFromProperties<Metadata extends VectorMetadata>(
  properties: Record<string, unknown>,
): Metadata | undefined {
  const metadata = Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => !key.startsWith(reservedPropertyPrefix) && key !== "_additional",
    ),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
