import {
  isJsonValue as isCoreJsonValue,
  isMessage,
  type JsonObject,
  type JsonValue,
} from "@anvia/core/completion";
import type { AgentTraceOptions } from "../types";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && isCoreJsonValue(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isCoreJsonValue(value);
}

export { isMessage };

export function isAgentTraceOptions(value: unknown): value is AgentTraceOptions {
  if (!isObject(value)) {
    return false;
  }
  if (
    !Object.keys(value).every((key) =>
      ["name", "userId", "sessionId", "metadata", "tags", "version", "traceId"].includes(key),
    )
  ) {
    return false;
  }
  return (
    optionalString(value.name) &&
    optionalString(value.userId) &&
    optionalString(value.sessionId) &&
    optionalString(value.version) &&
    optionalString(value.traceId) &&
    optionalStringArray(value.tags) &&
    (value.metadata === undefined || isJsonObject(value.metadata))
  );
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}
