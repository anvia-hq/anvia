import type { Document } from "../completion";
import type { VectorFilter, VectorSearchIndex, VectorSearchResult } from "../vector-store";

export type CreateContextIndexOptions<T = unknown> = {
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
  format?(result: VectorSearchResult<T>): Document;
};

export interface ContextIndex<T = unknown> extends CreateContextIndexOptions<T> {
  readonly kind: "context-index";
  readonly index: VectorSearchIndex<T>;
}

export function createContextIndex<T>(
  index: VectorSearchIndex<T>,
  options: CreateContextIndexOptions<T>,
): ContextIndex<T> {
  return Object.freeze({
    ...options,
    kind: "context-index" as const,
    index,
  });
}

export function isContextIndex(value: unknown): value is ContextIndex {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { kind?: unknown; index?: unknown };
  if (candidate.kind !== "context-index" || typeof candidate.index !== "object") {
    return false;
  }
  return (
    candidate.index !== null &&
    typeof (candidate.index as { search?: unknown }).search === "function"
  );
}
