import { mapWithConcurrency } from "../internal/concurrency";
import type {
  EmbedDocumentsOptions,
  EmbeddedDocument,
  Embedding,
  EmbeddingModel,
  VectorMetadata,
} from "./types";

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

  return prepared.map((item, index) => {
    const embeddings = byDocument.get(index) ?? [];
    if (item.metadata === undefined) {
      return { id: item.id, document: item.document, embeddings };
    }
    return { id: item.id, document: item.document, metadata: item.metadata, embeddings };
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
