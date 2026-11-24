import type { Document } from "../completion";
import type { EmbeddingModel, SparseEmbeddingModel } from "../embeddings";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import type { RetrySetting } from "../retry";
import { normalizeVectorFilter } from "../vector-store/filter";
import type {
  HybridVectorStore,
  VectorFilter,
  VectorFilterInput,
  VectorFusion,
  VectorRerankOptions,
  VectorSearchResult,
  VectorStore,
} from "../vector-store/types";

const DEFAULT_VECTOR_CONTEXT_TOP_K = 5;

export type VectorContextBaseOptions<T = unknown> = {
  topK?: number | undefined;
  minScore?: number | undefined;
  filter?: VectorFilterInput | undefined;
  rerank?(
    options: VectorRerankOptions<T>,
  ): Promise<readonly VectorSearchResult<T>[]> | readonly VectorSearchResult<T>[];
  candidateTopK?: number | undefined;
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
  | (Omit<CreateVectorContextOptions<T>, "topK" | "filter"> & {
      topK: number;
      filter?: VectorFilter | undefined;
    })
  | (Omit<CreateHybridVectorContextOptions<T>, "topK" | "filter"> & {
      topK: number;
      filter?: VectorFilter | undefined;
    })
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
  const topK = assertPositiveSearchLimit(options.topK ?? DEFAULT_VECTOR_CONTEXT_TOP_K);
  const minScore = assertFiniteMinScore(options.minScore);
  const filter = normalizeVectorFilter(options.filter);

  if (options.candidateTopK !== undefined) {
    assertPositiveSearchLimit(options.candidateTopK, "candidateTopK");
  }

  let context = {
    ...options,
    topK,
    kind: "vector-context" as const,
  } as Record<string, unknown>;

  if (minScore !== undefined) {
    context = { ...context, minScore };
  }

  if (filter !== undefined) {
    context = { ...context, filter };
  } else {
    delete context.filter;
  }

  return Object.freeze(context) as unknown as VectorContext<T>;
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
