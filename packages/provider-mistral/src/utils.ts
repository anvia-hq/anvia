import {
  CompletionProviderOutputError,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type Usage,
} from "@anvia/core/completion";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseToolArguments(toolCallId: string, text: string, usage?: Usage): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CompletionProviderOutputError({
      kind: "malformed-tool-arguments",
      toolCallId,
      usage,
    });
  }
  if (!isJsonValue(value)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }
  return value;
}

export function schemaName(schema: JsonObject): string {
  return typeof schema.title === "string" ? schema.title : "response_schema";
}
