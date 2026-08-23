import type { Document } from "../completion";
import type { EmbeddingModel, SparseEmbeddingModel } from "../embeddings";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import type { RetrySetting } from "../retry";
import type {
  HybridVectorStore,
  VectorFilter,
  VectorFusion,
  VectorSearchResult,
  VectorStore,
} from "../vector-store";

export type VectorContextBaseOptions<T = unknown> = {
  topK: number;
  minScore?: number | undefined;
  filter?: VectorFilter | undefined;
  retries?: RetrySetting | undefined;
  format?(result: VectorSearchResult<T>): Document;
};

export type CreateVectorContextOptions<T = unknown> = VectorContextBaseOptions<T> & {
  store: VectorStore<T>;
  model: EmbeddingModel;
  models?: never;
};

export type CreateHybridVectorContextOptions<T = unknown> = VectorContextBaseOptions<T> & {
  store: HybridVectorStore<T>;
  model?: never;
  models: { dense: EmbeddingModel; sparse: SparseEmbeddingModel };
  fusion?: VectorFusion | undefined;
};

export type VectorContext<T = unknown> = (
  | CreateVectorContextOptions<T>
  | CreateHybridVectorContextOptions<T>
) & {
  readonly kind: "vector-context";
};

export function createVectorContext<T>(options: CreateVectorContextOptions<T>): VectorContext<T>;
export function createVectorContext<T>(
  options: CreateHybridVectorContextOptions<T>,
): VectorContext<T>;
export function createVectorContext<T>(
  options: CreateVectorContextOptions<T> | CreateHybridVectorContextOptions<T>,
): VectorContext<T> {
  const topK = assertPositiveSearchLimit(options.topK);
  const minScore = assertFiniteMinScore(options.minScore);
  let context: VectorContext<T> = {
    ...options,
    topK,
    kind: "vector-context" as const,
  };
  if (minScore !== undefined) {
    context = { ...context, minScore };
  }
  return Object.freeze(context);
}

export function isVectorContext(value: unknown): value is VectorContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    kind?: unknown;
    store?: { search?: unknown };
    model?: unknown;
    models?: { dense?: unknown; sparse?: unknown };
  };
  if (candidate.kind !== "vector-context" || typeof candidate.store?.search !== "function") {
    return false;
  }
  return (
    candidate.model !== undefined ||
    (candidate.models?.dense !== undefined && candidate.models.sparse !== undefined)
  );
}
