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

export function parseToolArguments(toolCallId: string, text: string): JsonValue {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error(
      `Completion returned tool call "${toolCallId}" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.`,
    );
  }
}

export function schemaName(schema: JsonObject): string {
  return typeof schema.title === "string" ? schema.title : "response_schema";
}
