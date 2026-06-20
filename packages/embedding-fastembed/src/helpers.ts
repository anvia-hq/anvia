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

function vectorToArray(vector: unknown): number[] | undefined {
  if (Array.isArray(vector) && vector.every((item) => typeof item === "number")) {
    return vector;
  }

  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) {
    return Array.from(vector as unknown as ArrayLike<number>);
  }

  return undefined;
}
