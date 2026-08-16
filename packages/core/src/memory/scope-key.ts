import type { JsonObject, JsonValue } from "../completion/types";
import type { CreateMemoryScopeKeyOptions } from "./types";

export function createMemoryScopeKey(options: CreateMemoryScopeKeyOptions): string {
  const values: JsonValue[] = [options.scope.sessionId];

  if (options.includeUserId ?? true) {
    values.push(options.scope.userId ?? null);
  }

  for (const key of options.metadataKeys ?? []) {
    values.push(metadataValue(options.scope.metadata, key) ?? null);
  }

  return JSON.stringify(values);
}

function metadataValue(metadata: JsonObject | undefined, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = metadata;
  for (const part of path.split(".")) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
