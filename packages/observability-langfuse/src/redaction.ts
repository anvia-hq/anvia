import type { Message } from "@anvia/core/completion";

export type RedactorPattern = {
  name: string;
  regex: RegExp;
};

export type LangfuseRedactionOptions = {
  patterns?: RedactorPattern[];
  replacement?: string;
};

export type PiiRedactor = {
  redactString(input: string): string;
  redactObject<T>(input: T): T;
  redactMessages(input: Message[]): Message[];
  patternNames(): string[];
};

const DEFAULT_REPLACEMENT = "[REDACTED]";
const MAX_DEPTH = 16;

export function createPiiRedactor(options: LangfuseRedactionOptions = {}): PiiRedactor {
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  const compiled = patterns.map((p) => ({
    name: p.name,
    regex: cloneRegex(p.regex, "g"),
  }));
  const patternNamesList = patterns.map((p) => p.name);

  function redactString(input: string): string {
    if (typeof input !== "string") return input;
    let out = input;
    for (const { name, regex } of compiled) {
      out = applyPattern(out, name, regex, replacement);
    }
    return out;
  }

  function redactObject<T>(input: T): T {
    return redactValue(input, 0, redactString) as T;
  }

  function redactMessages(input: Message[]): Message[] {
    return input.map((message) => redactMessage(message, redactString));
  }

  function patternNames(): string[] {
    return patternNamesList;
  }

  return { redactString, redactObject, redactMessages, patternNames };
}

export const DEFAULT_PATTERNS: RedactorPattern[] = [
  { name: "email", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "creditCard", regex: /\b(?:\d[ -]?){13,19}\b/g },
  { name: "ipv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  {
    name: "phone",
    regex:
      /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{3,4})?(?!\d)/g,
  },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  {
    name: "apiKey",
    regex: /\b(?:sk|pk|api|key|token)[-_][A-Za-z0-9]{16,}\b/gi,
  },
];

function applyPattern(input: string, name: string, regex: RegExp, replacement: string): string {
  if (name === "creditCard") {
    return redactCreditCards(input, replacement);
  }
  return input.replace(regex, replacement);
}

function redactCreditCards(input: string, replacement: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (/\d/.test(ch)) {
      const { length, valid } = longestLuhnChunk(input.slice(i));
      if (valid) {
        out += replacement;
        i += length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function longestLuhnChunk(s: string): { length: number; valid: boolean } {
  let length = 0;
  let bestValid = 0;
  while (length < s.length && length < 40) {
    const ch = s.charAt(length);
    if (!/\d/.test(ch) && ch !== "-") break;
    length += 1;
    const candidate = s.slice(0, length).replace(/\D/g, "");
    if (candidate.length >= 13 && candidate.length <= 19) {
      if (startsWithKnownPrefix(candidate) && passesLuhn(candidate)) {
        bestValid = length;
      }
    }
  }
  return { length: bestValid, valid: bestValid > 0 };
}

function startsWithKnownPrefix(digits: string): boolean {
  if (digits.startsWith("4")) return true;
  const two = digits.slice(0, 2);
  if (two === "51" || two === "52" || two === "53" || two === "54" || two === "55") return true;
  const four = digits.slice(0, 4);
  if (four === "2221" || four === "2720") return true;
  const twoAgain = digits.slice(0, 2);
  if (twoAgain === "34" || twoAgain === "37") return true;
  if (four === "6011" || twoAgain === "65") return true;
  return digits.startsWith("35");
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const raw = digits.charCodeAt(i) - 48;
    let value = raw;
    if (alt) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function cloneRegex(source: RegExp, flags: string): RegExp {
  return new RegExp(source.source, flags + source.flags.replace(/g/g, ""));
}

function redactValue(
  value: unknown,
  depth: number,
  redactStringFn: (s: string) => string,
): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return redactStringFn(value);
  if (Array.isArray(value))
    return value.map((entry) => redactValue(entry, depth + 1, redactStringFn));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, depth + 1, redactStringFn);
    }
    return out;
  }
  return value;
}

function redactMessage(message: Message, redactStringFn: (s: string) => string): Message {
  if (!Array.isArray(message.content)) return message;
  const newContent = message.content.map((part) => {
    if (part === null || typeof part !== "object") return part;
    const rec = part as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      return { ...part, text: redactStringFn(rec.text) };
    }
    return part;
  });
  return { ...message, content: newContent as never };
}
