import type { JsonObject, JsonValue } from "@anvia/core/completion";

/**
 * Blob reference markers are the only JSON that the durable runtime interprets. Users can write
 * any JSON, including the same shapes, so a marker is trusted only when it is a registered object:
 * `reference()` registers the marker objects created by the blob writers, and `decodeStored()`
 * registers the marker keys it finds in the journal. Everything else is data.
 *
 * On disk, data keys are escaped so that a stored reserved key can only be a marker:
 *
 * - a key that starts with `~`, starts with `anvia:`, or equals `durableBlobs` is written with one
 *   extra leading `~`;
 * - a reserved key whose value is a registered marker is written as-is.
 *
 * `decodeStored()` reverses this exactly: a leading `~` is removed, and a plain reserved key is a
 * marker. The escape is injective, so user data round-trips unchanged.
 */

const registered = new WeakSet<object>();

/** Reserved keys: `anvia:blob` (whole value), `anvia:blobs` (by path), `durableBlobs` (message). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "anvia:blob",
  "anvia:blobs",
  "durableBlobs",
]);

/** Registers a marker object or marker array created by the runtime. Returns it unchanged. */
export function reference<T extends object>(value: T): T {
  registered.add(value);
  return value;
}

export function isReference(value: unknown): boolean {
  return typeof value === "object" && value !== null && registered.has(value);
}

export function escapeKey(key: string): string {
  return key.startsWith("~") || key.startsWith("anvia:") || key === "durableBlobs"
    ? `~${key}`
    : key;
}

/** The stored form of one logical JSON value. Registered markers are emitted unchanged. */
export function encodeStored(value: JsonValue): JsonValue {
  if (isReference(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => encodeStored(entry));
  if (value === null || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isReference(entry)) output[key] = entry;
    else output[escapeKey(key)] = encodeStored(entry);
  }
  return output;
}

/**
 * The logical form of one stored JSON value. Plain reserved keys are markers and are registered;
 * escaped keys lose one leading `~`. Parsing the stored text is the only caller.
 */
export function decodeStored(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => decodeStored(entry));
  if (value === null || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("~")) {
      output[key.slice(1)] = decodeStored(entry);
    } else if (RESERVED_KEYS.has(key) && typeof entry === "object" && entry !== null) {
      output[key] = reference(entry as JsonObject);
    } else {
      output[key] = decodeStored(entry);
    }
  }
  return output;
}

/**
 * Schema parsers return new objects, so a registered marker inside a parsed value would lose its
 * registration. This copies the registration from the input onto the parsed output, path by path.
 */
export function carryReferences<T>(input: unknown, output: T): T {
  if (typeof input !== "object" || input === null) return output;
  if (typeof output !== "object" || output === null) return output;
  if (isReference(input)) reference(output as object);
  if (Array.isArray(input) && Array.isArray(output)) {
    input.forEach((entry, index) => carryReferences(entry, output[index]));
  } else if (!Array.isArray(input) && !Array.isArray(output)) {
    for (const key of Object.keys(output)) {
      if (Object.prototype.hasOwnProperty.call(input, key))
        carryReferences(
          (input as Record<string, unknown>)[key],
          (output as Record<string, unknown>)[key],
        );
    }
  }
  return output;
}

/** Stored text for a logical JSON value (escaped, with markers as they are). */
export function writeStored(value: unknown): string {
  return JSON.stringify(encodeStored(value as JsonValue));
}

/** The logical value of stored text: markers are registered, escaped keys restored. */
export function readStored(text: string): JsonValue {
  return decodeStored(JSON.parse(text) as JsonValue);
}
