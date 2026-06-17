import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import type { AgentTraceOptions } from "@anvia/core/observability";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

export function isMessageInput(value: unknown): value is string | Message {
  return typeof value === "string" || isMessage(value);
}

export function isMessage(value: unknown): value is Message {
  if (!isObject(value) || typeof value.role !== "string") {
    return false;
  }
  if (value.role === "system") {
    return typeof value.content === "string";
  }
  if (value.role === "user" || value.role === "assistant" || value.role === "tool") {
    return Array.isArray(value.content);
  }
  return false;
}

export function isAgentTraceOptions(value: unknown): value is AgentTraceOptions {
  if (!isObject(value)) {
    return false;
  }
  return (
    optionalString(value.name) &&
    optionalString(value.userId) &&
    optionalString(value.sessionId) &&
    optionalString(value.version) &&
    optionalString(value.traceId) &&
    optionalBoolean(value.failOnObserverError) &&
    optionalStringArray(value.tags) &&
    optionalObject(value.metadata)
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

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function optionalObject(value: unknown): boolean {
  return value === undefined || isObject(value);
}
