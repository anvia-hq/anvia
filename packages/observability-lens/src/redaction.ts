import type { LensRedactionOptions, LensRedactorPattern } from "./types.js";

export const DEFAULT_PATTERNS: LensRedactorPattern[] = [
  { name: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  { name: "api-key", regex: /\b(?:sk|pk)[-_][A-Za-z0-9_-]{12,}\b/g },
  { name: "credit-card", regex: /\b(?:\d[ -]*?){13,19}\b/g },
];

export function createLensRedactor(options: LensRedactionOptions = {}) {
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const replacement = options.replacement ?? "<redacted>";
  const redact = (value: unknown): unknown =>
    deepRedact(value, patterns, replacement, new WeakSet());
  return { redact };
}

function deepRedact(
  value: unknown,
  patterns: LensRedactorPattern[],
  replacement: string,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return patterns.reduce((text, pattern) => text.replace(pattern.regex, replacement), value);
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "<circular>";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => deepRedact(entry, patterns, replacement, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      deepRedact(entry, patterns, replacement, seen),
    ]),
  );
}
