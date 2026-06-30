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
