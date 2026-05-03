export type Embedding = {
  document: string;
  vector: number[];
};

export interface EmbeddingModel {
  readonly dimensions?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  embedTexts(texts: string[]): Promise<Embedding[]>;
}

export type EmbeddedDocument<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  document: T;
  metadata?: Metadata | undefined;
  embeddings: Embedding[];
};

export type VectorMetadataValue = string | number | boolean | null;
export type VectorMetadata = Record<string, VectorMetadataValue>;

export type EmbedDocumentsOptions<T, Metadata extends VectorMetadata = VectorMetadata> = {
  id?: ((document: T, index: number) => string) | undefined;
  content(document: T, index: number): string | string[];
  metadata?: ((document: T, index: number) => Metadata | undefined) | undefined;
  concurrency?: number | undefined;
};

export async function embedText(model: EmbeddingModel, text: string): Promise<Embedding> {
  const embeddings = await embedTexts(model, [text]);
  const embedding = embeddings[0];
  if (embedding === undefined) {
    throw new Error("Embedding model returned no embeddings");
  }
  return embedding;
}

export async function embedTexts(model: EmbeddingModel, texts: string[]): Promise<Embedding[]> {
  if (texts.length === 0) {
    return [];
  }

  const maxBatchSize = Math.max(1, Math.trunc(model.maxBatchSize ?? texts.length));
  const batches: string[][] = [];
  for (let index = 0; index < texts.length; index += maxBatchSize) {
    batches.push(texts.slice(index, index + maxBatchSize));
  }

  const results = await mapWithConcurrency(batches, 1, (batch) => model.embedTexts(batch));
  const embeddings = results.flat();
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding model returned ${embeddings.length} embeddings for ${texts.length} texts`,
    );
  }
  return embeddings;
}

export async function embedDocuments<T, Metadata extends VectorMetadata = VectorMetadata>(
  model: EmbeddingModel,
  documents: T[],
  options: EmbedDocumentsOptions<T, Metadata>,
): Promise<Array<EmbeddedDocument<T, Metadata>>> {
  const prepared = documents.map((document, index) => {
    const content = options.content(document, index);
    const texts = Array.isArray(content) ? content : [content];
    return {
      id: options.id?.(document, index) ?? `doc${index}`,
      document,
      metadata: options.metadata?.(document, index),
      texts,
    };
  });

  const flatTexts = prepared.flatMap((item, documentIndex) =>
    item.texts.map((text) => ({ documentIndex, text })),
  );
  const embeddings = await mapWithConcurrency(
    chunk(flatTexts, Math.max(1, Math.trunc(model.maxBatchSize ?? (flatTexts.length || 1)))),
    Math.max(1, Math.trunc(options.concurrency ?? 1)),
    async (batch) => {
      const batchEmbeddings = await model.embedTexts(batch.map((item) => item.text));
      if (batchEmbeddings.length !== batch.length) {
        throw new Error(
          `Embedding model returned ${batchEmbeddings.length} embeddings for ${batch.length} texts`,
        );
      }
      return batch.map((item, index) => ({
        documentIndex: item.documentIndex,
        embedding: batchEmbeddings[index] as Embedding,
      }));
    },
  );

  const byDocument = new Map<number, Embedding[]>();
  for (const item of embeddings.flat()) {
    const list = byDocument.get(item.documentIndex) ?? [];
    list.push(item.embedding);
    byDocument.set(item.documentIndex, list);
  }

  return prepared.map((item, index) => ({
    id: item.id,
    document: item.document,
    ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
    embeddings: byDocument.get(index) ?? [],
  }));
}

export function dotProduct(left: number[], right: number[]): number {
  assertSameDimensions(left, right);
  return left.reduce((sum, value, index) => sum + value * (right[index] as number), 0);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  assertSameDimensions(left, right);
  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dotProduct(left, right) / (leftMagnitude * rightMagnitude);
}

export function angularDistance(left: number[], right: number[]): number {
  const similarity = Math.max(-1, Math.min(1, cosineSimilarity(left, right)));
  return Math.acos(similarity) / Math.PI;
}

export function euclideanDistance(left: number[], right: number[]): number {
  assertSameDimensions(left, right);
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - (right[index] as number)) ** 2, 0),
  );
}

export function manhattanDistance(left: number[], right: number[]): number {
  assertSameDimensions(left, right);
  return left.reduce((sum, value, index) => sum + Math.abs(value - (right[index] as number)), 0);
}

export function chebyshevDistance(left: number[], right: number[]): number {
  assertSameDimensions(left, right);
  return left.reduce(
    (max, value, index) => Math.max(max, Math.abs(value - (right[index] as number))),
    0,
  );
}

function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
}

function assertSameDimensions(left: number[], right: number[]): void {
  if (left.length !== right.length) {
    throw new Error(`Vector dimension mismatch: ${left.length} !== ${right.length}`);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
