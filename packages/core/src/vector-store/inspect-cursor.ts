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

/**
 * Error thrown when a vector-store inspect cursor cannot be parsed.
 *
 * Extends `RangeError` (so existing `RangeError` handling keeps working) with
 * a stable `name` hosts can use to map invalid cursors to a client error
 * without matching on the message or catching unrelated `RangeError`s.
 */
export class VectorInspectCursorError extends RangeError {
  constructor(cursor: string) {
    super(`Invalid vector inspect cursor: ${JSON.stringify(cursor)}.`);
    this.name = "VectorInspectCursorError";
  }

  /**
   * Identify an invalid-cursor failure without matching on the message, so
   * unrelated `RangeError`s are never mistaken for one. Uses a structural
   * check (rather than `instanceof`) so it also works across duplicated
   * module instances.
   */
  static isCursorError(error: unknown): error is VectorInspectCursorError {
    return (
      error instanceof VectorInspectCursorError ||
      (error instanceof RangeError && error.name === "VectorInspectCursorError")
    );
  }
}

export function parseVectorInspectCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!INSPECT_CURSOR_PATTERN.test(cursor)) {
    throw new VectorInspectCursorError(cursor);
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) {
    throw new VectorInspectCursorError(cursor);
  }
  return offset;
}
