import { embedSparseQuery, embedText, type VectorMetadata } from "../embeddings";
import { throwIfAborted } from "../internal/abort";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import { type ResolvedRetryOptions, resolveRetryOptions, runWithRetries } from "../retry";
import type {
  RetrieveDocumentsOptions,
  RetrieveHybridDocumentsOptions,
  VectorSearchResult,
} from "./types";

export function retrieveDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: RetrieveDocumentsOptions<T, Metadata>,
): Promise<Array<VectorSearchResult<T, Metadata>>>;
export function retrieveDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: RetrieveHybridDocumentsOptions<T, Metadata>,
): Promise<Array<VectorSearchResult<T, Metadata>>>;
export async function retrieveDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: RetrieveDocumentsOptions<T, Metadata> | RetrieveHybridDocumentsOptions<T, Metadata>,
): Promise<Array<VectorSearchResult<T, Metadata>>> {
  assertPositiveSearchLimit(options.topK);
  assertFiniteMinScore(options.minScore);
  throwIfAborted(options.abortSignal);
  const retries = resolveRetries(options.retries);
  const search = (operation: () => Promise<Array<VectorSearchResult<T, Metadata>>>) =>
    runWithRetries(operation, retries, {
      streaming: false,
      abortSignal: options.abortSignal,
    });

  if ("model" in options && options.model !== undefined) {
    const { embedding } = await embedText({
      model: options.model,
      text: options.query,
      retries: options.retries,
      abortSignal: options.abortSignal,
    });
    return deduplicateResults(
      await search(() =>
        options.store.search({
          vector: embedding.vector,
          topK: options.topK,
          minScore: options.minScore,
          filter: options.filter,
          abortSignal: options.abortSignal,
        }),
      ),
    );
  }

  const [{ embedding: dense }, { embedding: sparse }] = await Promise.all([
    embedText({
      model: options.models.dense,
      text: options.query,
      retries: options.retries,
      abortSignal: options.abortSignal,
    }),
    embedSparseQuery({
      model: options.models.sparse,
      query: options.query,
      retries: options.retries,
      abortSignal: options.abortSignal,
    }),
  ]);
  return deduplicateResults(
    await search(() =>
      options.store.searchHybrid({
        vector: dense.vector,
        sparseVector: sparse.vector,
        fusion: options.fusion,
        topK: options.topK,
        minScore: options.minScore,
        filter: options.filter,
        abortSignal: options.abortSignal,
      }),
    ),
  );
}

function deduplicateResults<T, Metadata extends VectorMetadata>(
  results: Array<VectorSearchResult<T, Metadata>>,
): Array<VectorSearchResult<T, Metadata>> {
  const bestById = new Map<string, VectorSearchResult<T, Metadata>>();
  for (const result of results) {
    const current = bestById.get(result.id);
    if (current === undefined || result.score > current.score) bestById.set(result.id, result);
  }
  return [...bestById.values()].sort((left, right) => right.score - left.score);
}

function resolveRetries(
  setting: RetrieveDocumentsOptions<unknown>["retries"],
): ResolvedRetryOptions | undefined {
  return setting === undefined || setting === false ? undefined : resolveRetryOptions(setting);
}
