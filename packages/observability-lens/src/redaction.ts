import {
  createRedactor,
  DEFAULT_PATTERNS as CORE_DEFAULT_PATTERNS,
  passesLuhn,
} from "@anvia/core/redaction";
import type { LensRedactionOptions, LensRedactorPattern } from "./types.js";

const DEFAULT_REPLACEMENT = "<redacted>";

export { passesLuhn };

export const DEFAULT_PATTERNS: LensRedactorPattern[] = [...CORE_DEFAULT_PATTERNS];

export type LensRedactor = {
  /** Returns a redacted copy of any JSON-compatible value; the source is never mutated. */
  redact(value: unknown): unknown;
};

export function createLensRedactor(options: LensRedactionOptions = {}): LensRedactor {
  return createRedactor({ replacement: DEFAULT_REPLACEMENT, ...options });
}
