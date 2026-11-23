import {
  CompletionProviderOutputError,
  isJsonValue,
  type CompletionModelStreamEvent,
  type JsonObject,
  type JsonValue,
  type ToolCallArgumentsMode,
  type ToolChoice,
  type Usage,
} from "../../completion/index";
import { isRecord } from "../record";

export type { Writable } from "../type-utils";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function schemaName(schema: JsonObject): string {
  return typeof schema.title === "string" ? schema.title : "response_schema";
}

export function compactJsonObject(values: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!isJsonValue(value)) {
        return [];
      }

      return [[key, value]];
    }),
  ) as JsonObject;
}

export function toolChoiceSummary(toolChoice: ToolChoice | undefined): JsonValue | undefined {
  if (toolChoice === undefined || typeof toolChoice === "string") {
    return toolChoice;
  }

  return { type: toolChoice.type, name: toolChoice.name };
}

export function parseToolArguments(toolCallId: string, text: string, usage?: Usage): JsonValue {
  if (text.trim() === "") return {};

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

export type ToolCallDeltaValues = {
  callId?: string | undefined;
  name?: string | undefined;
  argumentsDelta?: string | undefined;
  argumentsMode?: ToolCallArgumentsMode | undefined;
  signature?: string | undefined;
  omitEmptyIdentity?: boolean | undefined;
};

export function toolCallDelta(id: string, values: ToolCallDeltaValues): CompletionModelStreamEvent {
  const event: CompletionModelStreamEvent = { type: "tool_call_delta", id };

  if (
    values.callId !== undefined &&
    (values.omitEmptyIdentity !== true || values.callId.length > 0)
  ) {
    event.callId = values.callId;
  }

  if (values.name !== undefined && (values.omitEmptyIdentity !== true || values.name.length > 0)) {
    event.name = values.name;
  }

  if (values.argumentsDelta !== undefined) {
    event.argumentsDelta = values.argumentsDelta;
  }

  if (values.argumentsMode !== undefined) {
    event.argumentsMode = values.argumentsMode;
  }

  if (values.signature !== undefined) {
    event.signature = values.signature;
  }

  return event;
}
