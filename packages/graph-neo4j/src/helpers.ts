import { isInt } from "neo4j-driver";
import { parseNeo4jProperties } from "./schema.js";
import type { Neo4jProperties } from "./types.js";

export function quoteIdentifier(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Neo4j identifiers must be non-empty strings.");
  }
  if (value.includes("\u0000")) throw new TypeError("Neo4j identifiers must not contain NUL.");
  return `\`${value.replaceAll("`", "``")}\``;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

export function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function positiveInteger(value: number, label: string, maximum?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new RangeError(
      `${label} must be a positive safe integer${maximum === undefined ? "" : ` no greater than ${maximum}`}.`,
    );
  }
  return value;
}

export function finiteScore(value: number | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(value))
    throw new RangeError(`${label} must be finite.`);
}

export function strictProperties(value: unknown, label: string): Neo4jProperties {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value))
    normalized[key] = normalizeDriverValue(item, `${label}.${key}`);
  return parseNeo4jProperties(normalized, label);
}

function normalizeDriverValue(value: unknown, label: string): unknown {
  if (isInt(value)) {
    if (!value.inSafeRange()) throw new TypeError(`${label} contains an unsafe Neo4j integer.`);
    return value.toNumber();
  }
  if (Array.isArray(value))
    return value.map((item, index) => normalizeDriverValue(item, `${label}[${index}]`));
  return value;
}

export function stableObject(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}
