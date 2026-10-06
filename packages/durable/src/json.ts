import { isJsonValue, type JsonValue, type JsonObject } from "@anvia/core/completion";

/** Omit optional object fields, but reject values that JSON would silently corrupt. */
export function json(value: unknown): JsonValue {
  const normalized = normalize(value, new Set());
  if (!isJsonValue(normalized)) throw new TypeError("Durable state must be JSON serializable.");
  return normalized;
}

function normalize(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) throw new TypeError("Durable state contains a cycle.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) {
    throw new TypeError("Durable state requires plain JSON objects.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => normalize(item, ancestors));
    const output: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Durable state requires ordinary string-keyed fields.");
      }
      if (descriptor.value !== undefined) {
        Object.defineProperty(output, key, {
          value: normalize(descriptor.value, ancestors),
          enumerable: true,
        });
      }
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function sameJson(left: unknown, right: unknown): boolean {
  return canonical(json(left)) === canonical(json(right));
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as JsonObject)[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function nonblank(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 4096 ? message : `${message.slice(0, 4096)}…`;
}
