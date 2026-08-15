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
      id: pointId(logicalId),
      vectors: embedding.vector,
      properties,
    };
  });
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  minScore: number | undefined,
  metric: "cosine" | "dot" | "l2-squared",
): Array<VectorSearchResult<T, Metadata>> {
  const byId = new Map<string, VectorSearchResult<T, Metadata>>();
  const objects = (response as { objects?: Array<Record<string, unknown>> }).objects ?? [];

  for (const item of objects) {
    const properties = (item.properties as Record<string, unknown> | undefined) ?? {};
    const metadata = item.metadata as Record<string, unknown> | undefined;
    const distance = metadata?.distance as number | undefined;
    const score = distance === undefined ? 0 : metric === "cosine" ? 1 - distance : -distance;

    if (minScore !== undefined && score < minScore) {
      continue;
    }

    const id = String(properties[documentIdPropertyKey] ?? item.uuid ?? "");
    const result: VectorSearchResult<T, Metadata> = {
      id,
      score,
      document: parseDocument(properties[documentPropertyKey]),
    };
    const publicMetadata = metadataFromProperties<Metadata>(properties);
    if (publicMetadata !== undefined) {
      result.metadata = publicMetadata;
    }
    const current = byId.get(id);
    if (current === undefined || result.score > current.score) {
      byId.set(id, result);
    }
  }

  return [...byId.values()];
}

function metadataFromProperties<Metadata extends VectorMetadata>(
  properties: Record<string, unknown>,
): Metadata | undefined {
  const metadata = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !key.startsWith(reservedPropertyPrefix)),
  ) as Metadata;
  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
