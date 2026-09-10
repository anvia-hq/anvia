export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Drops entries whose value is `undefined`. Useful when building objects with
 * optional properties under `exactOptionalPropertyTypes` without conditional
 * spreads: `{ ...base, ...omitUndefined({ replyTo: input.replyTo }) }`.
 */
type DefinedValues<T extends object> = {
  [K in keyof T as T[K] extends undefined ? never : K]: NonNullable<T[K]>;
};

/**
 * Drops entries whose value is `undefined`. Useful when building objects with
 * optional properties under `exactOptionalPropertyTypes` without conditional
 * spreads: `{ ...base, ...omitUndefined({ replyTo: input.replyTo }) }`.
 */
export function omitUndefined<T extends object>(value: T): DefinedValues<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as DefinedValues<T>;
}
