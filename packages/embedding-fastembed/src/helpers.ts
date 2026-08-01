import type { SparseVector } from "@anvia/core/embeddings";

export function parseBatch(batch: unknown, offset: number): number[][] {
  if (!Array.isArray(batch)) {
    throw new Error(`FastEmbed embedding model returned an invalid batch at offset ${offset}`);
  }

  return batch.map((vector, index) => {
    const values = vectorToArray(vector);
    if (values === undefined) {
      throw new Error(
        `FastEmbed embedding model returned an invalid vector at index ${offset + index}`,
      );
    }
    return values;
  });
}

export function parseSparseBatch(batch: unknown, offset: number): SparseVector[] {
  if (!Array.isArray(batch)) {
    throw new Error(
      `FastEmbed sparse embedding model returned an invalid batch at offset ${offset}`,
    );
  }
  return batch.map((vector, index) => parseSparseVector(vector, offset + index));
}

export function parseSparseVector(vector: unknown, index: number): SparseVector {
  if (
    typeof vector !== "object" ||
    vector === null ||
    !("indices" in vector) ||
    !("values" in vector)
  ) {
    throw new Error(
      `FastEmbed sparse embedding model returned an invalid vector at index ${index}`,
    );
  }
  const indices = numberArray((vector as { indices: unknown }).indices);
  const values = numberArray((vector as { values: unknown }).values);
  if (indices === undefined || values === undefined || indices.length !== values.length) {
    throw new Error(
      `FastEmbed sparse embedding model returned an invalid vector at index ${index}`,
    );
  }
  return { indices, values };
}

function vectorToArray(vector: unknown): number[] | undefined {
  if (Array.isArray(vector) && vector.every((item) => typeof item === "number")) {
    return vector;
  }

  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) {
    return Array.from(vector as unknown as ArrayLike<number>);
  }

  return undefined;
}

function numberArray(value: unknown): number[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return value;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return undefined;
}
