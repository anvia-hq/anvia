import { isInt } from "neo4j-driver";
import { parseGraphProperties, type GraphProperties } from "@anvia/graph";

export function quoteIdentifier(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Memgraph identifier must be a non-empty string.");
  }
  return `\`${value.replaceAll("`", "``")}\``;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw abortError();
}

export function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function positiveInteger(value: number, label: string, maximum?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new RangeError(
      `${label} must be a positive safe integer${maximum === undefined ? "." : ` no greater than ${maximum}.`}`,
    );
  }
  return value;
}

export function strictProperties(value: unknown, label: string): GraphProperties {
  return parseGraphProperties(normalizeDriverValue(value, label), label);
}

export function driverNumber(value: unknown, label: string): number {
  if (isInt(value)) {
    if (!value.inSafeRange()) throw new TypeError(`${label} must be a safe number.`);
    return value.toNumber();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

export function stableObject(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(normalizeForComparison(value));
}

function normalizeDriverValue(value: unknown, label: string): unknown {
  if (isInt(value)) {
    if (!value.inSafeRange()) throw new TypeError(`${label} contains an unsafe integer.`);
    return value.toNumber();
  }
  if (Array.isArray(value)) return value.map((item) => normalizeDriverValue(item, label));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDriverValue(item, label)]),
    );
  }
  return value;
}

function normalizeForComparison(value: unknown): unknown {
  if (isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForComparison(item)]),
    );
  }
  return value;
}
