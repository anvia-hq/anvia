import { throwIfAborted } from "../internal/abort";
import { mapWithConcurrency } from "../internal/concurrency";
import type { ModelCallOptions } from "../model-call-options";
import { type ResolvedRetryOptions, resolveRetryOptions, runWithRetries } from "../retry";
import type {
  EmbedDocumentsOptions,
  EmbedDocumentsResult,
  EmbeddedDocument,
  Embedding,
  EmbeddingOperationOptions,
  EmbedHybridDocumentsOptions,
  EmbedSparseQueryOptions,
  EmbedSparseQueryResult,
  EmbedSparseTextsOptions,
  EmbedSparseTextsResult,
  EmbedTextOptions,
  EmbedTextResult,
  EmbedTextsOptions,
  EmbedTextsResult,
  SparseEmbedding,
  VectorMetadata,
} from "./types";

export async function embedText(options: EmbedTextOptions): Promise<EmbedTextResult> {
  const { embeddings } = await embedTexts({
    model: options.model,
    texts: [options.text],
    retries: options.retries,
    abortSignal: options.abortSignal,
  });
  const embedding = embeddings[0];
  if (embedding === undefined) throw new Error("Embedding model returned no embeddings");
  return { embedding };
}

export async function embedTexts(options: EmbedTextsOptions): Promise<EmbedTextsResult> {
  throwIfAborted(options.abortSignal);
  if (options.texts.length === 0) return { embeddings: [] };
  const batches = chunk(options.texts, batchSize(options.model.maxBatchSize, options.texts.length));
  const results = await mapWithConcurrency(batches, concurrency(options.concurrency), (batch) =>
    embedDenseBatch(options.model, batch, options),
  );
  const embeddings = results.flat();
  if (embeddings.length !== options.texts.length) {
    throw new Error(
      `Embedding model returned ${embeddings.length} embeddings for ${options.texts.length} texts`,
    );
  }
  return { embeddings };
}

export async function embedSparseTexts(
  options: EmbedSparseTextsOptions,
): Promise<EmbedSparseTextsResult> {
  throwIfAborted(options.abortSignal);
  if (options.texts.length === 0) return { embeddings: [] };
  const batches = chunk(options.texts, batchSize(options.model.maxBatchSize, options.texts.length));
  const results = await mapWithConcurrency(batches, concurrency(options.concurrency), (batch) =>
    embedSparseBatch(options.model, batch, options),
  );
  const embeddings = results.flat();
  if (embeddings.length !== options.texts.length) {
    throw new Error(
      `Sparse embedding model returned ${embeddings.length} embeddings for ${options.texts.length} texts`,
    );
  }
  return { embeddings };
}

export async function embedSparseQuery(
  options: EmbedSparseQueryOptions,
): Promise<EmbedSparseQueryResult> {
  throwIfAborted(options.abortSignal);
  const embedding = await runWithRetries(
    () => {
      throwIfAborted(options.abortSignal);
      return options.model.embedQuery(options.query, modelCallOptions(options.abortSignal));
    },
    resolveRetries(options),
    { streaming: false, abortSignal: options.abortSignal },
  );
  throwIfAborted(options.abortSignal);
  validateSparseEmbedding(embedding, "query");
  return { embedding };
}

export function embedDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: EmbedDocumentsOptions<T, Metadata>,
): Promise<EmbedDocumentsResult<T, Metadata>>;
export function embedDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: EmbedHybridDocumentsOptions<T, Metadata>,
): Promise<EmbedDocumentsResult<T, Metadata>>;
export async function embedDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  options: EmbedDocumentsOptions<T, Metadata> | EmbedHybridDocumentsOptions<T, Metadata>,
): Promise<EmbedDocumentsResult<T, Metadata>> {
  throwIfAborted(options.abortSignal);
  const prepared = prepareDocuments(options.documents, options);
  const flatTexts = prepared.flatMap((item, documentIndex) =>
    item.texts.map((text) => ({ documentIndex, text })),
  );
  const concurrencyLimit = concurrency(options.concurrency);

  if ("model" in options && options.model !== undefined) {
    const batches = chunk(flatTexts, batchSize(options.model.maxBatchSize, flatTexts.length || 1));
    const results = await mapWithConcurrency(batches, concurrencyLimit, async (batch) => {
      const embeddings = await embedDenseBatch(
        options.model,
        batch.map((item) => item.text),
        options,
      );
      assertBatchLength("Embedding", embeddings.length, batch.length);
      return batch.map((item, index) => ({
        documentIndex: item.documentIndex,
        embedding: embeddings[index] as Embedding,
      }));
    });
    const byDocument = groupEmbeddings(results.flat());
    return {
      documents: prepared.map((item, index) => embeddedDocument(item, byDocument.get(index) ?? [])),
    };
  }

  const { dense, sparse } = options.models;
  const [denseResults, sparseResults] = await Promise.all([
    mapWithConcurrency(
      chunk(flatTexts, batchSize(dense.maxBatchSize, flatTexts.length || 1)),
      concurrencyLimit,
      async (batch) => {
        const embeddings = await embedDenseBatch(
          dense,
          batch.map((item) => item.text),
          options,
        );
        assertBatchLength("Embedding", embeddings.length, batch.length);
        return batch.map((item, index) => ({
          documentIndex: item.documentIndex,
          embedding: embeddings[index] as Embedding,
        }));
      },
    ),
    mapWithConcurrency(
      chunk(flatTexts, batchSize(sparse.maxBatchSize, flatTexts.length || 1)),
      concurrencyLimit,
      async (batch) => {
        const embeddings = await embedSparseBatch(
          sparse,
          batch.map((item) => item.text),
          options,
        );
        assertBatchLength("Sparse embedding", embeddings.length, batch.length);
        return batch.map((item, index) => ({
          documentIndex: item.documentIndex,
          embedding: embeddings[index] as SparseEmbedding,
        }));
      },
    ),
  ]);
  const denseByDocument = groupEmbeddings(denseResults.flat());
  const sparseByDocument = groupEmbeddings(sparseResults.flat());
  return {
    documents: prepared.map((item, index) => {
      const embeddings = denseByDocument.get(index) ?? [];
      const sparseEmbeddings = sparseByDocument.get(index) ?? [];
      if (embeddings.length !== sparseEmbeddings.length) {
        throw new Error(
          `Hybrid embedding produced ${embeddings.length} dense and ${sparseEmbeddings.length} sparse vectors for document ${item.id}`,
        );
      }
      return embeddedDocument(item, embeddings, sparseEmbeddings);
    }),
  };
}

async function embedDenseBatch(
  model: EmbedTextOptions["model"],
  texts: string[],
  options: EmbeddingOperationOptions,
): Promise<Embedding[]> {
  throwIfAborted(options.abortSignal);
  const embeddings = await runWithRetries(
    () => model.embedTexts(texts, modelCallOptions(options.abortSignal)),
    resolveRetries(options),
    { streaming: false, abortSignal: options.abortSignal },
  );
  throwIfAborted(options.abortSignal);
  for (const [index, embedding] of embeddings.entries()) {
    validateDenseEmbedding(embedding, model.dimensions, index);
  }
  return embeddings;
}

async function embedSparseBatch(
  model: EmbedSparseTextsOptions["model"],
  texts: string[],
  options: EmbeddingOperationOptions,
): Promise<SparseEmbedding[]> {
  throwIfAborted(options.abortSignal);
  const embeddings = await runWithRetries(
    () => model.embedTexts(texts, modelCallOptions(options.abortSignal)),
    resolveRetries(options),
    { streaming: false, abortSignal: options.abortSignal },
  );
  throwIfAborted(options.abortSignal);
  for (const [index, embedding] of embeddings.entries()) validateSparseEmbedding(embedding, index);
  return embeddings;
}

function prepareDocuments<T, Metadata extends VectorMetadata>(
  documents: T[],
  options: Pick<EmbedDocumentsOptions<T, Metadata>, "id" | "content" | "metadata">,
) {
  const ids = new Set<string>();
  return documents.map((document, index) => {
    const id = options.id?.(document, index) ?? `doc${index}`;
    if (id.length === 0) throw new TypeError("Embedded document ids must not be empty");
    if (ids.has(id)) throw new TypeError(`Duplicate embedded document id: ${id}`);
    ids.add(id);
    const content = options.content(document, index);
    if (Array.isArray(content) && content.length === 0)
      throw new TypeError(`Embedded document ${id} must contain at least one text chunk`);
    return {
      id,
      document,
      metadata: options.metadata?.(document, index),
      texts: Array.isArray(content) ? content : [content],
    };
  });
}

function embeddedDocument<T, Metadata extends VectorMetadata>(
  item: { id: string; document: T; metadata: Metadata | undefined },
  embeddings: Embedding[],
  sparseEmbeddings?: SparseEmbedding[],
): EmbeddedDocument<T, Metadata> {
  let result: EmbeddedDocument<T, Metadata> = {
    id: item.id,
    document: item.document,
    embeddings,
  };
  if (item.metadata !== undefined) {
    result = { ...result, metadata: item.metadata };
  }
  if (sparseEmbeddings !== undefined) {
    result = { ...result, sparseEmbeddings };
  }
  return result;
}

function groupEmbeddings<E>(
  items: Array<{ documentIndex: number; embedding: E }>,
): Map<number, E[]> {
  const groups = new Map<number, E[]>();
  for (const item of items) {
    const list = groups.get(item.documentIndex) ?? [];
    list.push(item.embedding);
    groups.set(item.documentIndex, list);
  }
  return groups;
}

function assertBatchLength(name: string, actual: number, expected: number): void {
  if (actual !== expected)
    throw new Error(`${name} model returned ${actual} embeddings for ${expected} texts`);
}

function resolveRetries(options: EmbeddingOperationOptions): ResolvedRetryOptions | undefined {
  return options.retries === undefined || options.retries === false
    ? undefined
    : resolveRetryOptions(options.retries);
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

function batchSize(configured: number | undefined, fallback: number): number {
  if (configured === undefined) return fallback;
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new RangeError("Embedding model maxBatchSize must be a positive safe integer");
  }
  return configured;
}

function concurrency(configured: number | undefined): number {
  if (configured === undefined) return 1;
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new RangeError("Embedding concurrency must be a positive safe integer");
  }
  return configured;
}

function validateDenseEmbedding(
  embedding: Embedding,
  dimensions: number | undefined,
  index: number,
): void {
  if (embedding.vector.length === 0) {
    throw new TypeError(`Embedding model returned an empty vector at index ${index}`);
  }
  if (!embedding.vector.every(Number.isFinite)) {
    throw new TypeError(`Embedding model returned a non-finite vector at index ${index}`);
  }
  if (dimensions !== undefined) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1)
      throw new TypeError("Embedding model dimensions must be a positive safe integer");
    if (embedding.vector.length !== dimensions) {
      throw new Error(
        `Embedding model returned ${embedding.vector.length} dimensions at index ${index}; expected ${dimensions}`,
      );
    }
  }
}

function validateSparseEmbedding(embedding: SparseEmbedding, index: number | "query"): void {
  const { indices, values } = embedding.vector;
  if (indices.length !== values.length) {
    throw new Error(`Sparse embedding at ${index} has mismatched indices and values`);
  }
  if (!indices.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError(`Sparse embedding at ${index} has an invalid index`);
  }
  if (new Set(indices).size !== indices.length) {
    throw new TypeError(`Sparse embedding at ${index} has duplicate indices`);
  }
  if (!values.every(Number.isFinite)) {
    throw new TypeError(`Sparse embedding at ${index} has a non-finite value`);
  }
}
