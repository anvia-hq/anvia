export function assertPositiveSearchLimit(value: number, name = "topK"): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function assertFiniteMinScore(
  value: number | undefined,
  name = "minScore",
): number | undefined {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
  return value;
}
