import type { StudioTraceStatus } from "../types";

export function optionalQueryString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Parse a `limit` query parameter.
 *
 * @param value   Raw query-string value.
 * @param defaultMax  Default when the parameter is absent.
 * @param max     Upper bound (values above are clamped).
 */
export function parseLimit(
  value: string | undefined,
  defaultMax = 50,
  max = 100,
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return defaultMax;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, max);
}

export function parseTraceStatus(value: string | undefined): StudioTraceStatus | undefined | false {
  const status = optionalQueryString(value);
  if (status === undefined) {
    return undefined;
  }
  return status === "running" || status === "success" || status === "error" ? status : false;
}

/**
 * Parse an `after` (cursor / sequence) query parameter.
 *
 * Returns `undefined` when absent, `false` when invalid, or the
 * parsed non-negative integer.
 */
export function parseAfter(value: string | undefined): number | undefined | false {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const after = Number(value);
  if (!Number.isInteger(after) || after < 0) {
    return false;
  }
  return after;
}
