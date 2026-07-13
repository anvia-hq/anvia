import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import type { ChromaClientLike, ChromaCollectionLike } from "./types.js";

export function serializeDocument(document: unknown): string {
  return typeof document === "string" ? document : JSON.stringify(document);
}

export function parseDocument<T>(document: string | null | undefined): T {
  if (document === null || document === undefined) {
    return "" as T;
  }
  try {
    return JSON.parse(document) as T;
  } catch {
    return document as T;
  }
}

export function chromaRecords<T, Metadata extends VectorMetadata>(
  document: EmbeddedDocument<T, Metadata>,
): Array<{
  id: string;
  document: string;
  metadata: VectorMetadata | undefined;
  embedding: number[];
}> {
  if (document.embeddings.length === 0) {
    throw new Error(`Document ${document.id} has no embeddings`);
  }

  return document.embeddings.map((embedding, index) => ({
    id: document.embeddings.length === 1 ? document.id : `${document.id}#embedding:${index}`,
    document: serializeDocument(document.document),
    metadata: document.metadata,
    embedding: embedding.vector,
  }));
}

export function logicalDocumentId(id: string): string {
  return id.replace(/#embedding:\d+$/, "");
}

export function distanceToCosineScore(distance: number): number {
  return 1 - distance;
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  threshold: number | undefined,
): Array<VectorSearchResult<T, Metadata>> {
  const raw = response as {
    ids?: string[][];
    documents?: Array<Array<string | null>>;
    metadatas?: Array<Array<Metadata | null>>;
    distances?: number[][];
  };
  const ids = raw.ids?.[0] ?? [];
  const documents = raw.documents?.[0] ?? [];
  const metadatas = raw.metadatas?.[0] ?? [];
  const distances = raw.distances?.[0] ?? [];

  const results = ids.flatMap((id, index) => {
    const score = distanceToCosineScore(distances[index] ?? 0);
    if (threshold !== undefined && score < threshold) {
      return [];
    }
    const result: VectorSearchResult<T, Metadata> = {
      id: logicalDocumentId(id),
      score,
      document: parseDocument(documents[index]),
    };
    const metadata = metadatas[index];
    if (metadata !== null && metadata !== undefined) {
      result.metadata = metadata;
    }
    return [result];
  });

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();
  for (const result of results) {
    if (!byId.has(result.id)) {
      byId.set(result.id, result);
    }
  }
  return [...byId.values()];
}

export async function defaultChromaClient(): Promise<ChromaClientLike> {
  const chroma = await import("chromadb");
  return new chroma.ChromaClient() as ChromaClientLike;
}

export async function getOrCreateCollection(
  client: ChromaClientLike,
  options: Record<string, unknown>,
): Promise<ChromaCollectionLike> {
  try {
    return await client.getCollection(options);
  } catch {
    return await client.createCollection(options);
  }
}
