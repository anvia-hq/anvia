import type { Embedding } from "../../embeddings/index";
import { isNumberArray, isPlainObject } from "./values";

export type IndexedEmbeddingData = {
  index: number;
  embedding: number[];
};

export async function embedTextBatches(
  texts: string[],
  maxBatchSize: number,
  embedBatch: (batch: string[]) => Promise<Embedding[]>,
): Promise<Embedding[]> {
  const embeddings: Embedding[] = [];
  for (let index = 0; index < texts.length; index += maxBatchSize) {
    const batch = texts.slice(index, index + maxBatchSize);
    embeddings.push(...(await embedBatch(batch)));
  }
  return embeddings;
}

export function indexedEmbeddingDataFromResponse(
  response: unknown,
  inputLength: number,
  providerLabel?: string,
): IndexedEmbeddingData[] {
  const raw = isPlainObject(response) ? response : {};
  const data = Array.isArray(raw.data) ? raw.data : [];
  const byIndex = new Map<number, IndexedEmbeddingData>();

  for (const [position, item] of data.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(
        providerLabel === undefined
          ? `Embedding response item ${position} contained an invalid index`
          : `Invalid ${providerLabel} embedding response row at position ${position}.`,
      );
    }

    const index = item.index;

    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new Error(
        providerLabel === undefined
          ? `Embedding response item ${position} contained an invalid index`
          : `Invalid ${providerLabel} embedding response index at position ${position}.`,
      );
    }

    if (index < 0 || index >= inputLength) {
      throw new Error(
        providerLabel === undefined
          ? `Embedding response index ${index} was outside input range 0..${inputLength - 1}`
          : `${providerLabel} embedding response index ${index} was outside the input range.`,
      );
    }

    if (byIndex.has(index)) {
      throw new Error(
        providerLabel === undefined
          ? `Embedding response contained duplicate index ${index}`
          : `Duplicate ${providerLabel} embedding response index ${index}.`,
      );
    }

    if (!isNumberArray(item.embedding)) {
      throw new Error(
        providerLabel === undefined
          ? `Embedding response item ${position} contained an invalid embedding`
          : `Invalid ${providerLabel} embedding response vector at position ${position}.`,
      );
    }

    byIndex.set(index, { index, embedding: item.embedding });
  }

  return Array.from({ length: inputLength }, (_, index) => byIndex.get(index)).filter(
    (item): item is IndexedEmbeddingData => item !== undefined,
  );
}
