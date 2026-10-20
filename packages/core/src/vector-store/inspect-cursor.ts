/**
 * Strict parser for vector-store inspect cursors.
 *
 * Cursors are opaque decimal offsets produced by `inspect` (`nextCursor`).
 * Accept the absent cursor (start of the collection) and canonical
 * non-negative integer strings only: anything else — non-numeric text,
 * signs, fractions, exponents, whitespace, or values outside the safe-integer
 * range — throws a `RangeError` describing the offending cursor instead of
 * silently coercing to an unrelated page.
 */
const INSPECT_CURSOR_PATTERN = /^(0|[1-9]\d*)$/;

export function parseVectorInspectCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!INSPECT_CURSOR_PATTERN.test(cursor)) {
    throw new RangeError(`Invalid vector inspect cursor: ${JSON.stringify(cursor)}.`);
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError(`Invalid vector inspect cursor: ${JSON.stringify(cursor)}.`);
  }
  return offset;
}
