export function defaultOutputValue(output: unknown): unknown {
  if (typeof output === "object" && output !== null && "output" in output) {
    return (output as { output: unknown }).output;
  }
  return output;
}

export function evalValuesEqual(left: unknown, right: unknown): boolean {
  return deepEqual(left, right, new WeakMap<object, object>());
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepEqual(left: unknown, right: unknown, seen: WeakMap<object, object>): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof RegExp && right instanceof RegExp) return String(left) === String(right);
  if (
    !Array.isArray(left) &&
    Object.getPrototypeOf(left) !== Object.prototype &&
    Object.getPrototypeOf(left) !== null
  ) {
    return false;
  }
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    if (
      !deepEqual(
        (left as Record<PropertyKey, unknown>)[key],
        (right as Record<PropertyKey, unknown>)[key],
        seen,
      )
    ) {
      return false;
    }
  }
  return true;
}
