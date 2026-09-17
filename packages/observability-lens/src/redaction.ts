import type { LensRedactionOptions, LensRedactorPattern } from "./types.js";

const MAX_DEPTH = 16;
const CIRCULAR_MARKER = "<circular>";
const MAX_DEPTH_MARKER = "<max-depth>";
const DATA_URL_PATTERN = /^data:[^;,]+;base64,/i;

export const DEFAULT_PATTERNS: LensRedactorPattern[] = [
  { name: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "credit-card", regex: /\b(?:\d[ -]?){13,19}\b/g, validate: isCardNumber },
  { name: "ipv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Phone patterns require an international prefix or a parenthesized area code: matching bare
  // 3-4 digit groups would mangle grouped identifiers such as order numbers.
  {
    name: "phone",
    regex:
      /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?(?!\d)/g,
  },
  {
    name: "phone-intl",
    regex: /(?<!\d)\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?(?!\d)/g,
  },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  { name: "api-key", regex: /\b(?:sk|pk)[-_][A-Za-z0-9_-]{12,}\b/g },
];

export type LensRedactor = {
  /** Returns a redacted copy of any JSON-compatible value; the source is never mutated. */
  redact(value: unknown): unknown;
};

export function createLensRedactor(options: LensRedactionOptions = {}): LensRedactor {
  const replacement = options.replacement ?? "<redacted>";
  const patterns = (options.patterns ?? DEFAULT_PATTERNS).map((pattern) => ({
    regex: cloneRegex(pattern.regex),
    validate: pattern.validate,
  }));
  const redactString = (value: string): string => {
    if (DATA_URL_PATTERN.test(value)) return value;
    let text = value;
    for (const pattern of patterns) {
      text = text.replace(pattern.regex, (match) =>
        pattern.validate === undefined || pattern.validate(match) ? replacement : match,
      );
    }
    return text;
  };
  return {
    redact: (value: unknown) => deepRedact(value, redactString, new WeakSet<object>(), 0),
  };
}

function deepRedact(
  value: unknown,
  redactString: (value: string) => string,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") return redactString(value);
  // Numbers keep their type unless their text matches a pattern, so unrelated numeric fields such as
  // token counts or timestamps survive untouched while a bare card number does not.
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value;
    const text = String(value);
    const redacted = redactString(text);
    return redacted === text ? value : redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return MAX_DEPTH_MARKER;
  if (seen.has(value)) return CIRCULAR_MARKER;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => deepRedact(entry, redactString, seen, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        deepRedact(entry, redactString, seen, depth + 1),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

/**
 * Card patterns match any 13-19 digit run, so the replacement is gated on an issuer prefix and a
 * Luhn checksum to keep order numbers, timestamps, and other long identifiers intact.
 */
function isCardNumber(match: string): boolean {
  const digits = match.replaceAll(/[^0-9]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  return startsWithIssuerPrefix(digits) && passesLuhn(digits);
}

function startsWithIssuerPrefix(digits: string): boolean {
  const two = digits.slice(0, 2);
  const four = digits.slice(0, 4);
  if (digits.startsWith("4")) return true;
  if (two === "34" || two === "37" || two === "65" || two === "35") return true;
  if (two >= "51" && two <= "55") return true;
  return four === "6011" || (four >= "2221" && four <= "2720");
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function cloneRegex(source: RegExp): RegExp {
  return source.flags.includes("g") ? source : new RegExp(source.source, `${source.flags}g`);
}
