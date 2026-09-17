import { createRedactor, DEFAULT_PATTERNS as CORE_DEFAULT_PATTERNS } from "@anvia/core/redaction";
import type { RedactionOptions, RedactionPattern, Redactor } from "@anvia/core/redaction";

const DEFAULT_REPLACEMENT = "[REDACTED]";

export type RedactorPattern = RedactionPattern;

export type LangfuseRedactionOptions = RedactionOptions;

export type PiiRedactor = Redactor;

export const DEFAULT_PATTERNS: RedactorPattern[] = [...CORE_DEFAULT_PATTERNS];

export { passesLuhn } from "@anvia/core/redaction";

export function createPiiRedactor(options: LangfuseRedactionOptions = {}): PiiRedactor {
  return createRedactor({ replacement: DEFAULT_REPLACEMENT, ...options });
}
