export function parseVectors(value: unknown, expectedLength: number): number[][] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(
      `Transformers embedding model returned ${Array.isArray(value) ? value.length : 0} embeddings for ${expectedLength} texts`,
    );
  }

  return value.map((vector, index) => {
    if (!Array.isArray(vector) || !vector.every((item) => typeof item === "number")) {
      throw new Error(`Transformers embedding model returned an invalid vector at index ${index}`);
    }
    return vector;
  });
}
