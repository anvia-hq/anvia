import type { Message } from "../completion";

const MAX_DEPTH = 16;
const CIRCULAR_MARKER = "<circular>";
const MAX_DEPTH_MARKER = "<max-depth>";
const DEFAULT_REPLACEMENT = "<redacted>";
const DATA_URL_PATTERN = /^data:[^;,]+;base64,/i;
const ENCODED_VALUE_TYPES: Record<string, true> = {
  base64: true,
  encrypted: true,
  image: true,
  redacted: true,
};

export type RedactionPattern = {
  name: string;
  regex: RegExp;
  /**
   * Optional filter for matches `regex` cannot fully qualify. Rejected matches are kept verbatim.
   * Receives the match, its offset, and the full input so a pattern can inspect its surroundings.
   */
  validate?: ((match: string, offset: number, input: string) => boolean) | undefined;
  /**
   * Match numeric values whose decimal text matches. Numbers are never inspected in any other way,
   * so unrelated numeric fields keep their value and type.
   */
  numeric?: boolean | undefined;
};

export type RedactionOptions = {
  patterns?: RedactionPattern[] | undefined;
  replacement?: string | undefined;
};

export type Redactor = {
  /** Returns a redacted copy of any JSON-compatible value; the source is never mutated. */
  redact(value: unknown): unknown;
  redactString(value: string): string;
  redactObject<T>(value: T): T;
  redactMessages<M extends Message>(messages: M[]): M[];
  patternNames(): string[];
};

/**
 * Default PII patterns. They favor precision over recall: card matches must carry an issuer prefix
 * and a valid Luhn checksum, and phone matches must not be part of a longer digit run, so grouped
 * identifiers such as order numbers survive redaction.
 */
export const DEFAULT_PATTERNS: RedactionPattern[] = [
  { name: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // The final digit is separate so a trailing separator is not part of the match.
  { name: "creditCard", regex: /\b(?:\d[ -]?){12,18}\d\b/g, validate: isCardNumber, numeric: true },
  { name: "ipv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  {
    name: "phone",
    regex:
      /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?(?!\d)/g,
    validate: isStandalonePhoneRun,
  },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: "apiKey", regex: /\b(?:sk|pk|api|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi },
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
];

export function createRedactor(options: RedactionOptions = {}): Redactor {
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const compiled = patterns.map((pattern) => ({
    regex: cloneRegex(pattern.regex),
    validate: pattern.validate,
    numeric: pattern.numeric === true,
  }));
  const names = patterns.map((pattern) => pattern.name);

  const applyPatterns = (input: string, numericOnly: boolean): string => {
    let text = input;
    for (const pattern of compiled) {
      if (numericOnly && !pattern.numeric) continue;
      text = text.replace(pattern.regex, (...args: unknown[]) => {
        const match = String(args[0]);
        // Capture groups shift the callback arguments. Regexes with named groups append the groups
        // object after the input, so offset and input are the last two or three values.
        const hasGroups = typeof args[args.length - 1] === "object";
        const offset = Number(args[args.length - (hasGroups ? 3 : 2)]);
        const source = String(args[args.length - (hasGroups ? 2 : 1)]);
        return pattern.validate === undefined || pattern.validate(match, offset, source)
          ? replacement
          : match;
      });
    }
    return text;
  };

  const redactString = (value: string): string => {
    if (typeof value !== "string") return value;
    if (DATA_URL_PATTERN.test(value)) return value;
    return applyPatterns(value, false);
  };

  const redactValue = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (typeof value === "string") return redactString(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return value;
      const text = String(value);
      const redacted = applyPatterns(text, true);
      return redacted === text ? value : redacted;
    }
    if (value === null || typeof value !== "object") return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    if (depth >= MAX_DEPTH) return MAX_DEPTH_MARKER;
    if (seen.has(value)) return CIRCULAR_MARKER;
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry, depth + 1, seen));
      }
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(record)) {
        // Encoded bodies are already opaque; scanning them only risks corrupting the payload.
        // Structured data still needs traversal, so only encoded strings are preserved verbatim.
        if (key === "data" && typeof entry === "string" && isEncodedValue(record)) {
          result[key] = entry;
          continue;
        }
        result[key] = redactValue(entry, depth + 1, seen);
      }
      return result;
    } finally {
      seen.delete(value);
    }
  };

  return {
    redact: (value: unknown) => redactValue(value, 0, new WeakSet<object>()),
    redactString,
    // Callers declare the value type, so the redacted copy is cast back to it.
    redactObject: <T>(value: T): T => redactValue(value, 0, new WeakSet<object>()) as T,
    redactMessages: <M extends Message>(messages: M[]): M[] =>
      messages.map((message) => redactValue(message, 0, new WeakSet<object>()) as M),
    patternNames: () => [...names],
  };
}

function isEncodedValue(record: Record<string, unknown>): boolean {
  return typeof record.type === "string" && ENCODED_VALUE_TYPES[record.type] === true;
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

/**
 * Phone patterns tolerate several shapes, which also matches one segment of a longer grouped digit
 * run. Only standalone runs are replaced, so `1234 5678 9012 3456` stays intact.
 */
function isStandalonePhoneRun(match: string, offset: number, input: string): boolean {
  const before = input.slice(0, offset);
  const after = input.slice(offset + match.length);
  return !/[0-9][\s.-]?$/.test(before) && !/^[\s.-]?[0-9]/.test(after);
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
