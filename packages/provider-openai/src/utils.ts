import type { JsonObject, JsonValue } from "@anvia/core/completion";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseJsonValue(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export function schemaName(schema: JsonObject): string {
  return typeof schema.title === "string" ? schema.title : "response_schema";
}
