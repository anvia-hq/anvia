import type { JsonValue, Message } from "@anvia/core";

export function parseMemoryMessage(value: unknown): Message {
  if (!isMemoryMessage(value)) {
    throw new TypeError("Stored SQLite memory row does not contain a valid Anvia Message.");
  }
  return value;
}

export function isMemoryMessage(value: unknown): value is Message {
  if (!isRecord(value)) {
    return false;
  }

  if (value.role === "system") {
    return typeof value.content === "string";
  }

  if (value.role === "user") {
    return Array.isArray(value.content) && value.content.every(isUserContent);
  }

  if (value.role === "assistant") {
    return (
      (value.id === undefined || typeof value.id === "string") &&
      Array.isArray(value.content) &&
      value.content.every(isAssistantContent)
    );
  }

  if (value.role === "tool") {
    return Array.isArray(value.content) && value.content.every(isToolContent);
  }

  return false;
}

export function serializeUnknownError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  if (isJsonValue(error)) {
    return error;
  }

  return {
    message: String(error),
  };
}

function isUserContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return (
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }

  if (value.type === "image") {
    return isImageContent(value);
  }

  if (value.type === "document") {
    return isDocumentContent(value);
  }

  return false;
}

function isAssistantContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return (
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }

  if (value.type === "reasoning") {
    return (
      typeof value.text === "string" &&
      (value.id === undefined || typeof value.id === "string") &&
      (value.content === undefined ||
        (Array.isArray(value.content) && value.content.every(isReasoningContent)))
    );
  }

  if (value.type === "tool_call") {
    return (
      typeof value.id === "string" &&
      (value.callId === undefined || typeof value.callId === "string") &&
      isRecord(value.function) &&
      typeof value.function.name === "string" &&
      isJsonValue(value.function.arguments) &&
      (value.signature === undefined || typeof value.signature === "string") &&
      (value.additionalParams === undefined || isJsonValue(value.additionalParams))
    );
  }

  if (value.type === "image") {
    return isImageContent(value);
  }

  return false;
}

function isReasoningContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return (
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }

  if (value.type === "summary") {
    return typeof value.text === "string";
  }

  if (value.type === "encrypted" || value.type === "redacted") {
    return typeof value.data === "string";
  }

  return false;
}

function isToolContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "tool_result" &&
    typeof value.id === "string" &&
    (value.callId === undefined || typeof value.callId === "string") &&
    Array.isArray(value.content) &&
    value.content.every(isToolResultContent)
  );
}

function isToolResultContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image") {
    return (
      typeof value.data === "string" &&
      (value.mediaType === undefined || typeof value.mediaType === "string")
    );
  }

  return false;
}

function isImageContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return (
      typeof value.source.url === "string" &&
      (value.detail === undefined || isImageDetail(value.detail))
    );
  }

  if (value.source.type === "base64") {
    return (
      typeof value.source.data === "string" &&
      typeof value.source.mediaType === "string" &&
      (value.detail === undefined || isImageDetail(value.detail))
    );
  }

  return false;
}

function isImageDetail(value: unknown): boolean {
  return value === "auto" || value === "low" || value === "high";
}

function isDocumentContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return (
      typeof value.source.url === "string" &&
      typeof value.source.mediaType === "string" &&
      (value.source.filename === undefined || typeof value.source.filename === "string")
    );
  }

  if (value.source.type === "base64") {
    return (
      typeof value.source.data === "string" &&
      typeof value.source.mediaType === "string" &&
      (value.source.filename === undefined || typeof value.source.filename === "string")
    );
  }

  if (value.source.type === "text") {
    return (
      typeof value.source.text === "string" &&
      (value.source.mediaType === undefined || typeof value.source.mediaType === "string") &&
      (value.source.filename === undefined || typeof value.source.filename === "string")
    );
  }

  return false;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value) || typeof value !== "number";
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return (
    isRecord(value) && Object.values(value).every((item) => item === undefined || isJsonValue(item))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
