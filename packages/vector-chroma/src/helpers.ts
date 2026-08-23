import type { EmbeddedDocument, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorSearchResult } from "@anvia/core/vector-store";
import type { ChromaClientLike, ChromaCollectionLike, ChromaVectorStoreOptions } from "./types.js";

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
    metadata: { ...document.metadata, __anvia_document_id: document.id },
    embedding: embedding.vector,
  }));
}

export function logicalDocumentId(id: string): string {
  return id.replace(/#embedding:\d+$/, "");
}

export function distanceToScore(
  distance: number,
  metric: ChromaVectorStoreOptions["metric"],
): number {
  return metric === "euclidean" ? -distance : 1 - distance;
}

export function parseQueryResults<T, Metadata extends VectorMetadata>(
  response: unknown,
  minScore: number | undefined,
  metric: ChromaVectorStoreOptions["metric"],
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
    const score = distanceToScore(distances[index] ?? 0, metric);
    if (minScore !== undefined && score < minScore) {
      return [];
    }
    const result: VectorSearchResult<T, Metadata> = {
      id: logicalDocumentId(id),
      score,
      document: parseDocument(documents[index]),
    };
    const metadata = metadatas[index];
    if (metadata !== null && metadata !== undefined) {
      const { __anvia_document_id: _documentId, ...publicMetadata } = metadata;
      if (Object.keys(publicMetadata).length > 0) result.metadata = publicMetadata as Metadata;
    }
    return [result];
  });

  const byId = new Map<string, VectorSearchResult<T, Metadata>>();
  for (const result of results) {
    const current = byId.get(result.id);
    if (current === undefined || result.score > current.score) byId.set(result.id, result);
  }
  return [...byId.values()];
}

export function chromaResultCount(response: unknown): number {
  return (response as { ids?: string[][] }).ids?.[0]?.length ?? 0;
}

export async function getOrCreateCollection(
  client: ChromaClientLike,
  options: Record<string, unknown>,
): Promise<ChromaCollectionLike> {
  try {
    return await client.getCollection(options);
  } catch (error) {
    if (!isMissingCollectionError(error)) throw error;
    return await client.createCollection(options);
  }
}

function isMissingCollectionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:not found|does not exist|unknown collection|missing|404)/i.test(error.message)
  );
}
