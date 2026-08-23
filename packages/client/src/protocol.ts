import {
  parseAgentInteractionRequest,
  parseAgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import { isJsonValue, parseMessages } from "@anvia/core/completion";
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientDataMap,
  type ClientDataSchemas,
  type ClientMetadataSchema,
  type ClientStreamError,
  type ClientStreamEvent,
  type ClientStreamFrame,
  type ClientStreamRequest,
  type UIMessage,
  type UIMessageGeneration,
  type UIMessagePart,
} from "./types";

export class ClientProtocolError extends Error {
  constructor(
    message: string,
    readonly value?: unknown,
  ) {
    super(message);
    this.name = "ClientProtocolError";
  }
}

export function parseUIMessage<
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(
  value: unknown,
  options: {
    metadataSchema?: ClientMetadataSchema<Metadata>;
    dataSchemas?: ClientDataSchemas<Data>;
  } = {},
): UIMessage<Metadata, Data> {
  const message = requireRecord(value, "UI message");
  if (!isJsonValue(message)) {
    throw new ClientProtocolError("UI messages must be strict JSON values.", value);
  }
  requireOnlyKeys(
    message,
    ["id", "role", "parts", "modelMessageId", "metadata", "generation"],
    "UI message",
  );
  if (typeof message.id !== "string") invalid("UI message.id", value);
  requireOneOf(message.role, ["system", "user", "assistant", "tool"], "UI message.role", value);
  if (!Array.isArray(message.parts)) invalid("UI message.parts", value);
  const parts = message.parts.map((part) => parseUIMessagePart(part, options.dataSchemas, value));
  if (message.modelMessageId !== undefined && typeof message.modelMessageId !== "string") {
    invalid("UI message.modelMessageId", value);
  }
  const metadata =
    message.metadata === undefined
      ? undefined
      : parseMetadata(message.metadata, options.metadataSchema, value);
  if (message.generation !== undefined && !isUIMessageGeneration(message.generation)) {
    invalid("UI message.generation", value);
  }
  let parsed: UIMessage<Metadata, Data> = {
    id: message.id as string,
    role: message.role as UIMessage<Metadata, Data>["role"],
    parts,
  };
  if (message.modelMessageId !== undefined) {
    parsed = { ...parsed, modelMessageId: message.modelMessageId as string };
  }
  if (metadata !== undefined) parsed = { ...parsed, metadata };
  if (message.generation !== undefined) {
    parsed = { ...parsed, generation: message.generation as UIMessageGeneration };
  }
  return parsed;
}

export function parseUIMessages<
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(
  value: unknown,
  options: {
    metadataSchema?: ClientMetadataSchema<Metadata>;
    dataSchemas?: ClientDataSchemas<Data>;
  } = {},
): UIMessage<Metadata, Data>[] {
  if (!Array.isArray(value)) {
    throw new ClientProtocolError("UI messages must be an array.", value);
  }
  return value.map((message) => parseUIMessage<Metadata, Data>(message, options));
}

export function parseClientStreamRequest(value: unknown): ClientStreamRequest {
  const input = requireRecord(value, "Client stream request");
  requireOnlyKeys(
    input,
    ["type", "messages", "interactionId", "response", "metadata", "resume"],
    "Client stream request",
  );
  requireOneOf(
    input.type,
    ["messages", "interaction_response"],
    "Client stream request.type",
    value,
  );
  if (input.metadata !== undefined && !isJsonObject(input.metadata)) {
    throw new ClientProtocolError("Client stream request.metadata must be a JSON object.", value);
  }
  let request: ClientStreamRequest;
  if (input.type === "messages") {
    if (input.interactionId !== undefined || input.response !== undefined) {
      throw new ClientProtocolError(
        "Messages requests cannot include interaction response fields.",
        value,
      );
    }
    let messages: Message[];
    try {
      messages = parseMessages(input.messages);
    } catch {
      throw new ClientProtocolError("Client stream request.messages must be Message[].", value);
    }
    request = { type: "messages", messages };
  } else {
    if (input.messages !== undefined || typeof input.interactionId !== "string") {
      throw new ClientProtocolError(
        "Interaction response requests require interactionId and cannot include messages.",
        value,
      );
    }
    try {
      request = {
        type: "interaction_response",
        interactionId: input.interactionId,
        response: parseAgentInteractionResponse(input.response),
      };
    } catch {
      throw new ClientProtocolError("Client interaction response is invalid.", value);
    }
  }
  if (input.metadata !== undefined) request.metadata = input.metadata as JsonObject;
  if (input.resume !== undefined) {
    const resume = requireRecord(input.resume, "Client stream request.resume");
    requireOnlyKeys(resume, ["streamId", "after"], "Client stream request.resume");
    if (typeof resume.streamId !== "string" || !isEventId(resume.after)) {
      throw new ClientProtocolError(
        "Client stream resume cursor requires streamId and a nonnegative safe integer after.",
        value,
      );
    }
    request.resume = { streamId: resume.streamId, after: resume.after };
  }
  return request;
}

export function parseClientStreamEvent<
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(
  value: unknown,
  options: {
    metadataSchema?: ClientMetadataSchema<Metadata>;
    dataSchemas?: ClientDataSchemas<Data>;
  } = {},
): ClientStreamEvent<Metadata, Data> {
  const event = requireRecord(value, "Client stream event");
  if (!isJsonValue(event)) {
    throw new ClientProtocolError("Client stream events must be strict JSON values.", value);
  }
  if (typeof event.type !== "string" || typeof event.runId !== "string") {
    throw new ClientProtocolError("Client stream events require type and runId.", value);
  }
  if (event.turn !== undefined && !isPositiveEventId(event.turn)) {
    throw new ClientProtocolError(
      "Client stream event.turn must be a positive safe integer.",
      value,
    );
  }
  if (event.scope !== undefined && !isScope(event.scope)) {
    throw new ClientProtocolError("Client stream event.scope is invalid.", value);
  }

  switch (event.type) {
    case "run_start":
      requireEventKeys(event, ["source", "metadata"]);
      requireOneOf(event.source, ["completion", "agent"], "run_start.source", value);
      break;
    case "turn_start":
      requireEventKeys(event, []);
      if (!isPositiveEventId(event.turn)) invalid("turn_start.turn", value);
      break;
    case "generation_start":
      requireEventKeys(event, ["model"]);
      if (
        event.model !== undefined &&
        (!isRecord(event.model) ||
          !hasOnlyKeys(event.model, ["provider", "modelId"]) ||
          typeof event.model.provider !== "string" ||
          typeof event.model.modelId !== "string")
      ) {
        invalid("generation_start.model", value);
      }
      break;
    case "message_start":
      requireEventKeys(event, ["messageId", "role", "metadata"]);
      requireStrings(event, ["messageId"], value);
      if (event.role !== "assistant") invalid("message_start.role", value);
      break;
    case "text_start":
      requireEventKeys(event, ["messageId", "partId"]);
      requireStrings(event, ["messageId", "partId"], value);
      break;
    case "text_delta":
      requireEventKeys(event, ["messageId", "partId", "delta"]);
      requireStrings(event, ["messageId", "partId", "delta"], value);
      break;
    case "reasoning_delta":
      requireEventKeys(event, ["messageId", "partId", "delta", "contentType", "signature"]);
      requireStrings(event, ["messageId", "partId", "delta"], value);
      requireOptionalStrings(event, ["signature"], value);
      if (
        event.contentType !== undefined &&
        !["text", "summary", "encrypted", "redacted"].includes(event.contentType as string)
      ) {
        invalid("reasoning_delta.contentType", value);
      }
      break;
    case "text_end":
      requireEventKeys(event, ["messageId", "partId", "text", "signature"]);
      requireStrings(event, ["messageId", "partId"], value);
      requireOptionalStrings(event, ["text", "signature"], value);
      break;
    case "reasoning_start":
      requireEventKeys(event, ["messageId", "partId", "reasoningId"]);
      requireStrings(event, ["messageId", "partId"], value);
      requireOptionalStrings(event, ["reasoningId"], value);
      break;
    case "reasoning_end":
      requireEventKeys(event, ["messageId", "partId", "text", "content"]);
      requireStrings(event, ["messageId", "partId"], value);
      requireOptionalStrings(event, ["text"], value);
      if (
        event.content !== undefined &&
        (!Array.isArray(event.content) || !event.content.every(isReasoningContent))
      ) {
        invalid("reasoning_end.content", value);
      }
      break;
    case "tool_call_start":
      requireEventKeys(event, ["messageId", "partId", "toolCallId", "callId", "toolName"]);
      requireStrings(event, ["messageId", "partId", "toolCallId"], value);
      requireOptionalStrings(event, ["callId", "toolName"], value);
      break;
    case "tool_call_delta":
      requireEventKeys(event, [
        "messageId",
        "partId",
        "toolCallId",
        "callId",
        "toolName",
        "delta",
        "mode",
        "signature",
      ]);
      requireStrings(event, ["messageId", "partId", "toolCallId", "delta"], value);
      requireOptionalStrings(event, ["callId", "toolName"], value);
      requireOptionalStrings(event, ["signature"], value);
      requireOneOf(event.mode, ["append", "replace"], "tool_call_delta.mode", value);
      break;
    case "tool_call_end":
      requireEventKeys(event, [
        "messageId",
        "partId",
        "toolCallId",
        "callId",
        "toolName",
        "input",
        "signature",
      ]);
      requireStrings(event, ["messageId", "partId", "toolCallId", "toolName"], value);
      requireOptionalStrings(event, ["callId", "signature"], value);
      if (!isJsonValue(event.input)) invalid("tool_call_end.input", value);
      break;
    case "tool_result":
      requireEventKeys(event, [
        "messageId",
        "partId",
        "toolCallId",
        "callId",
        "internalCallId",
        "toolName",
        "input",
        "result",
      ]);
      requireStrings(event, ["messageId", "partId", "toolCallId", "toolName"], value);
      requireOptionalStrings(event, ["callId", "internalCallId"], value);
      if (!isJsonValue(event.input)) invalid("tool_result.input", value);
      if (!isRecord(event.result)) invalid("tool_result.result", value);
      if (event.result.status === "success") {
        if (
          !hasOnlyKeys(event.result, ["status", "output", "content"]) ||
          !isJsonValue(event.result.output) ||
          (event.result.content !== undefined &&
            (!Array.isArray(event.result.content) ||
              !event.result.content.every(isToolResultContent)))
        ) {
          invalid("tool_result.result", value);
        }
      } else if (event.result.status === "error") {
        if (
          !hasOnlyKeys(event.result, ["status", "error"]) ||
          !isClientStreamError(event.result.error)
        ) {
          invalid("tool_result.result", value);
        }
      } else {
        invalid("tool_result.result.status", value);
      }
      break;
    case "source":
      requireEventKeys(event, ["messageId", "partId", "source"]);
      requireStrings(event, ["messageId", "partId"], value);
      if (!isCompletionSource(event.source)) invalid("source.source", value);
      break;
    case "attachment":
      requireEventKeys(event, ["messageId", "partId", "attachment"]);
      requireStrings(event, ["messageId", "partId"], value);
      if (!isAttachment(event.attachment)) invalid("attachment.attachment", value);
      break;
    case "provider_tool_call":
      requireEventKeys(event, ["toolCall"]);
      if (!isProviderToolCall(event.toolCall)) invalid("provider_tool_call.toolCall", value);
      break;
    case "interaction":
      requireEventKeys(event, ["interaction"]);
      try {
        parseAgentInteractionRequest(event.interaction);
      } catch {
        invalid("interaction.interaction", value);
      }
      break;
    case "guardrail_decision":
      requireEventKeys(event, ["decision"]);
      if (!isGuardrailDecision(event.decision)) invalid("guardrail_decision.decision", value);
      break;
    case "data":
      requireEventKeys(event, ["name", "data", "transient"]);
      requireStrings(event, ["name"], value);
      if (!isJsonValue(event.data)) invalid("data.data", value);
      if (event.transient !== undefined && typeof event.transient !== "boolean") {
        invalid("data.transient", value);
      }
      return {
        ...event,
        data: parseDataEvent(event.name as string, event.data, options.dataSchemas, value),
      } as ClientStreamEvent<Metadata, Data>;
    case "message_end":
      requireEventKeys(event, [
        "messageId",
        "modelMessageId",
        "parts",
        "usage",
        "contextUsage",
        "metadata",
      ]);
      requireStrings(event, ["messageId"], value);
      requireOptionalStrings(event, ["modelMessageId"], value);
      if (event.parts !== undefined) {
        if (!Array.isArray(event.parts)) invalid("message_end.parts", value);
        const parts = event.parts.map((part) =>
          parseUIMessagePart(part, options.dataSchemas, value),
        );
        validateUsageAndContext(event, value);
        return parseEventMetadata(
          { ...event, parts },
          options.metadataSchema,
          value,
        ) as ClientStreamEvent<Metadata, Data>;
      }
      validateUsageAndContext(event, value);
      break;
    case "turn_end":
      requireEventKeys(event, ["usage", "contextUsage", "firstDeltaMs"]);
      if (!isPositiveEventId(event.turn)) invalid("turn_end.turn", value);
      if (event.firstDeltaMs !== undefined && !isNonnegativeNumber(event.firstDeltaMs)) {
        invalid("turn_end.firstDeltaMs", value);
      }
      validateUsageAndContext(event, value);
      break;
    case "memory_compaction":
      requireEventKeys(event, [
        "originalMessageCount",
        "compactedMessageCount",
        "retainedMessageCount",
        "originalTokenCount",
        "compactedTokenCount",
        "retainedTokenCount",
        "resultTokenCount",
        "attempts",
        "usage",
      ]);
      validateMemoryCompactionInfo(event, value);
      break;
    case "run_end":
      requireEventKeys(event, [
        "status",
        "text",
        "output",
        "usage",
        "contextUsage",
        "trace",
        "memoryCompaction",
        "metadata",
      ]);
      requireOneOf(
        event.status,
        ["completed", "blocked", "suspended", "cancelled", "error"],
        "run_end.status",
        value,
      );
      requireOptionalStrings(event, ["text"], value);
      validateUsageAndContext(event, value);
      if (event.trace !== undefined && !isTrace(event.trace)) invalid("run_end.trace", value);
      if (event.memoryCompaction !== undefined) {
        if (!isRecord(event.memoryCompaction)) invalid("run_end.memoryCompaction", value);
        requireOnlyKeys(
          event.memoryCompaction,
          [
            "originalMessageCount",
            "compactedMessageCount",
            "retainedMessageCount",
            "originalTokenCount",
            "compactedTokenCount",
            "retainedTokenCount",
            "resultTokenCount",
            "attempts",
            "usage",
          ],
          "run_end.memoryCompaction",
        );
        validateMemoryCompactionInfo(event.memoryCompaction, value);
      }
      break;
    case "error":
      requireEventKeys(event, ["error", "usage"]);
      if (!isClientStreamError(event.error)) invalid("error.error", value);
      if (event.usage !== undefined && !isUsage(event.usage)) invalid("error.usage", value);
      break;
    default:
      throw new ClientProtocolError(`Unknown client stream event type "${event.type}".`, value);
  }

  return parseEventMetadata(event, options.metadataSchema, value) as ClientStreamEvent<
    Metadata,
    Data
  >;
}

export function parseClientStreamFrame<
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(
  value: unknown,
  options: {
    metadataSchema?: ClientMetadataSchema<Metadata>;
    dataSchemas?: ClientDataSchemas<Data>;
  } = {},
): ClientStreamFrame<Metadata, Data> {
  const frame = requireRecord(value, "Client stream frame");
  if (!isJsonValue(frame)) {
    throw new ClientProtocolError("Client stream frames must be strict JSON values.", value);
  }
  if (typeof frame.type !== "string") {
    throw new ClientProtocolError("Client stream frames require type.", value);
  }
  if (frame.type === "stream_start") {
    requireOnlyKeys(
      frame,
      ["type", "protocol", "streamId", "eventId", "resumable"],
      "stream_start frame",
    );
    if (frame.protocol === "anvia.client.v1" || frame.protocol === "anvia.client.v2") {
      throw new ClientProtocolError(
        `Client stream protocol ${frame.protocol.slice(-2)} is not supported.`,
        value,
      );
    }
    if (
      frame.protocol !== CLIENT_STREAM_PROTOCOL ||
      typeof frame.streamId !== "string" ||
      frame.eventId !== 0 ||
      typeof frame.resumable !== "boolean"
    ) {
      throw new ClientProtocolError("Invalid client stream_start frame.", value);
    }
    return frame as ClientStreamFrame<Metadata, Data>;
  }
  if (frame.type === "stream_event") {
    requireOnlyKeys(frame, ["type", "streamId", "eventId", "event"], "stream_event frame");
    if (typeof frame.streamId !== "string" || !isPositiveEventId(frame.eventId)) {
      throw new ClientProtocolError("Invalid client stream_event frame.", value);
    }
    const event = parseClientStreamEvent(frame.event, options);
    return { ...frame, event } as ClientStreamFrame<Metadata, Data>;
  }
  if (frame.type === "stream_end") {
    requireOnlyKeys(frame, ["type", "streamId", "eventId", "status"], "stream_end frame");
    if (typeof frame.streamId !== "string" || !isEventId(frame.eventId)) {
      throw new ClientProtocolError("Invalid client stream_end frame.", value);
    }
    requireOneOf(frame.status, ["completed", "error", "missing"], "stream_end.status", value);
    return frame as ClientStreamFrame<Metadata, Data>;
  }
  throw new ClientProtocolError(`Unknown client stream frame type "${frame.type}".`, value);
}

export function maskedClientError(): ClientStreamError {
  return { message: "An unexpected error occurred." };
}

export function normalizeClientError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isClientStreamError(value)) {
    const error = new Error(value.message);
    if (value.name !== undefined) error.name = value.name;
    return error;
  }
  return new Error(typeof value === "string" ? value : "An unexpected error occurred.");
}

function parseDataEvent<TData extends ClientDataMap>(
  name: string,
  data: unknown,
  schemas: ClientDataSchemas<TData> | undefined,
  value: unknown,
): JsonValue {
  if (schemas === undefined) return data as JsonValue;
  const schema = schemas[name as keyof TData];
  if (schema === undefined) {
    throw new ClientProtocolError(`Invalid data event "${name}".`, value);
  }
  const parsed = schema.safeParse(data);
  if (parsed.success !== true || !isJsonValue(parsed.data)) {
    throw new ClientProtocolError(`Invalid data event "${name}".`, value);
  }
  return parsed.data;
}

function parseUIMessagePart<Data extends ClientDataMap>(
  value: unknown,
  schemas: ClientDataSchemas<Data> | undefined,
  root: unknown,
): UIMessagePart<Data> {
  if (!isUIMessagePart(value)) {
    throw new ClientProtocolError("UI message contains an invalid part.", root);
  }
  if (value.type !== "data") {
    return value as UIMessagePart<Data>;
  }
  return {
    ...value,
    data: parseDataEvent(value.name, value.data, schemas, root),
  } as UIMessagePart<Data>;
}

function parseMetadata<Metadata extends JsonObject>(
  value: unknown,
  schema: ClientMetadataSchema<Metadata> | undefined,
  root: unknown,
): Metadata {
  if (schema === undefined) {
    if (!isJsonObject(value)) {
      throw new ClientProtocolError("Client metadata must be a JSON object.", root);
    }
    return value as Metadata;
  }
  const parsed = schema.safeParse(value);
  if (parsed.success !== true || !isJsonObject(parsed.data)) {
    throw new ClientProtocolError("Invalid client metadata.", root);
  }
  return parsed.data;
}

function parseEventMetadata<Metadata extends JsonObject>(
  event: Record<string, unknown>,
  schema: ClientMetadataSchema<Metadata> | undefined,
  root: unknown,
): Record<string, unknown> {
  if (event.metadata === undefined) return event;
  return { ...event, metadata: parseMetadata(event.metadata, schema, root) };
}

function isUIMessageGeneration(value: unknown): value is UIMessageGeneration {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, ["runId", "status", "usage", "contextUsage", "trace", "memoryCompaction"])
  ) {
    return false;
  }
  return (
    (value.runId === undefined || typeof value.runId === "string") &&
    (value.status === undefined ||
      ["completed", "blocked", "suspended", "cancelled", "error"].includes(
        value.status as string,
      )) &&
    (value.usage === undefined || isUsage(value.usage)) &&
    (value.contextUsage === undefined || isContextUsage(value.contextUsage)) &&
    (value.trace === undefined || isTrace(value.trace)) &&
    (value.memoryCompaction === undefined ||
      (isRecord(value.memoryCompaction) &&
        validateMemoryCompactionForGuard(value.memoryCompaction)))
  );
}

function validateMemoryCompactionForGuard(value: Record<string, unknown>): boolean {
  try {
    requireOnlyKeys(
      value,
      [
        "originalMessageCount",
        "compactedMessageCount",
        "retainedMessageCount",
        "originalTokenCount",
        "compactedTokenCount",
        "retainedTokenCount",
        "resultTokenCount",
        "attempts",
        "usage",
      ],
      "memory compaction",
    );
    validateMemoryCompactionInfo(value, value);
    return true;
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

function isClientStreamError(value: unknown): value is ClientStreamError {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "message", "code", "retryable", "details"]) &&
    typeof value.message === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.code === undefined || typeof value.code === "string") &&
    (value.retryable === undefined || typeof value.retryable === "boolean") &&
    (value.details === undefined || isJsonValue(value.details))
  );
}

function isScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "agentId",
    "agentName",
    "parentRunId",
    "parentToolName",
    "parentToolCallId",
    "parentInternalToolCallId",
  ];
  return (
    hasOnlyKeys(value, keys) &&
    keys.every((key) => value[key] === undefined || typeof value[key] === "string")
  );
}

function isAttachment(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.type !== "image" && value.type !== "document" && value.type !== "file") return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "type",
      "name",
      "mediaType",
      "url",
      "data",
      "text",
      "detail",
      "metadata",
    ]) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.mediaType === undefined || typeof value.mediaType === "string") &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.data === undefined || typeof value.data === "string") &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.detail === undefined || ["auto", "low", "high"].includes(value.detail as string)) &&
    (value.metadata === undefined || isJsonValue(value.metadata))
  );
}

function isUIMessagePart(value: unknown): value is UIMessagePart {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "text") {
    return (
      hasOnlyKeys(value, ["id", "type", "text", "signature"]) &&
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }
  if (value.type === "reasoning") {
    return (
      hasOnlyKeys(value, ["id", "type", "text", "reasoningId", "content"]) &&
      typeof value.text === "string" &&
      (value.reasoningId === undefined || typeof value.reasoningId === "string") &&
      (value.content === undefined ||
        (Array.isArray(value.content) && value.content.every(isReasoningContent)))
    );
  }
  if (value.type === "source") {
    return hasOnlyKeys(value, ["id", "type", "source"]) && isCompletionSource(value.source);
  }
  if (value.type === "data") {
    return (
      hasOnlyKeys(value, ["id", "type", "name", "data"]) &&
      typeof value.name === "string" &&
      isJsonValue(value.data)
    );
  }
  if (value.type === "attachment") {
    return hasOnlyKeys(value, ["id", "type", "attachment"]) && isAttachment(value.attachment);
  }
  if (value.type === "error") {
    return hasOnlyKeys(value, ["id", "type", "error"]) && isClientStreamError(value.error);
  }
  if (
    value.type !== "tool" ||
    !hasOnlyKeys(value, [
      "id",
      "type",
      "toolName",
      "toolCallId",
      "callId",
      "internalCallId",
      "turn",
      "state",
      "input",
      "output",
      "resultContent",
      "signature",
      "error",
    ]) ||
    typeof value.toolName !== "string" ||
    typeof value.toolCallId !== "string" ||
    (value.callId !== undefined && typeof value.callId !== "string") ||
    (value.internalCallId !== undefined && typeof value.internalCallId !== "string") ||
    (value.turn !== undefined && !isPositiveEventId(value.turn)) ||
    (value.signature !== undefined && typeof value.signature !== "string")
  ) {
    return false;
  }
  if (value.state === "input-streaming") {
    return (
      typeof value.input === "string" &&
      value.output === undefined &&
      value.resultContent === undefined &&
      value.error === undefined
    );
  }
  if (value.state === "input-available") {
    return (
      isJsonValue(value.input) &&
      value.output === undefined &&
      value.resultContent === undefined &&
      value.error === undefined
    );
  }
  if (value.state === "output-available") {
    return (
      isJsonValue(value.input) &&
      isJsonValue(value.output) &&
      (value.resultContent === undefined ||
        (Array.isArray(value.resultContent) && value.resultContent.every(isToolResultContent))) &&
      value.error === undefined
    );
  }
  return (
    value.state === "error" &&
    isJsonValue(value.input) &&
    value.output === undefined &&
    value.resultContent === undefined &&
    isClientStreamError(value.error)
  );
}

function isReasoningContent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text") {
    return (
      hasOnlyKeys(value, ["type", "text", "signature"]) &&
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }
  if (value.type === "summary") {
    return hasOnlyKeys(value, ["type", "text"]) && typeof value.text === "string";
  }
  if (value.type === "encrypted" || value.type === "redacted") {
    return hasOnlyKeys(value, ["type", "data"]) && typeof value.data === "string";
  }
  return false;
}

function isToolResultContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "text") {
    return (
      hasOnlyKeys(value, ["type", "text", "signature"]) &&
      typeof value.text === "string" &&
      (value.signature === undefined || typeof value.signature === "string")
    );
  }
  return (
    value.type === "file" &&
    hasOnlyKeys(value, ["type", "data", "mediaType", "filename"]) &&
    isFileData(value.data) &&
    typeof value.mediaType === "string" &&
    (value.filename === undefined || typeof value.filename === "string")
  );
}

function isFileData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "url") {
    return hasOnlyKeys(value, ["type", "url"]) && typeof value.url === "string";
  }
  if (value.type === "data") {
    return hasOnlyKeys(value, ["type", "data"]) && typeof value.data === "string";
  }
  return (
    value.type === "text" && hasOnlyKeys(value, ["type", "text"]) && typeof value.text === "string"
  );
}

function isCompletionSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "url" &&
    hasOnlyKeys(value, ["type", "url", "title", "id", "startIndex", "endIndex"]) &&
    typeof value.url === "string" &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.startIndex === undefined || isNonnegativeNumber(value.startIndex)) &&
    (value.endIndex === undefined || isNonnegativeNumber(value.endIndex))
  );
}

function isProviderToolCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "name", "status", "details"]) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.status === undefined || typeof value.status === "string") &&
    (value.details === undefined || (isRecord(value.details) && isJsonValue(value.details)))
  );
}

function isGuardrailDecision(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "policyId",
      "guardrailId",
      "boundary",
      "mode",
      "action",
      "applied",
      "reason",
      "message",
      "metadata",
      "latencyMs",
    ]) &&
    typeof value.policyId === "string" &&
    typeof value.guardrailId === "string" &&
    (value.boundary === "input" || value.boundary === "output") &&
    (value.mode === "enforce" || value.mode === "observe") &&
    typeof value.action === "string" &&
    ["allow", "block", "rewrite", "error"].includes(value.action) &&
    typeof value.applied === "boolean" &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.metadata === undefined || (isRecord(value.metadata) && isJsonValue(value.metadata))) &&
    isNonnegativeNumber(value.latencyMs)
  );
}

function isUsage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cachedInputTokens",
      "cacheCreationInputTokens",
      "details",
    ]) ||
    ![
      value.inputTokens,
      value.outputTokens,
      value.totalTokens,
      value.cachedInputTokens,
      value.cacheCreationInputTokens,
    ].every(isNonnegativeNumber)
  ) {
    return false;
  }
  return (
    value.details === undefined ||
    (isRecord(value.details) && Object.values(value.details).every(isNonnegativeNumber))
  );
}

function isContextUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.model) || !isRecord(value.model.context)) return false;
  const context = value.model.context;
  return (
    hasOnlyKeys(value, [
      "model",
      "usedTokens",
      "remainingTokens",
      "usedPercent",
      "remainingPercent",
    ]) &&
    hasOnlyKeys(value.model, ["modelId", "context"]) &&
    typeof value.model.modelId === "string" &&
    hasOnlyKeys(context, ["contextWindow", "maxInputTokens", "maxOutputTokens"]) &&
    isNonnegativeNumber(context.contextWindow) &&
    (context.maxInputTokens === undefined || isNonnegativeNumber(context.maxInputTokens)) &&
    (context.maxOutputTokens === undefined || isNonnegativeNumber(context.maxOutputTokens)) &&
    isNonnegativeNumber(value.usedTokens) &&
    isNonnegativeNumber(value.remainingTokens) &&
    isNonnegativeNumber(value.usedPercent) &&
    isNonnegativeNumber(value.remainingPercent)
  );
}

function validateUsageAndContext(event: Record<string, unknown>, original: unknown): void {
  if (event.usage !== undefined && !isUsage(event.usage)) {
    invalid(`${String(event.type)}.usage`, original);
  }
  if (event.contextUsage !== undefined && !isContextUsage(event.contextUsage)) {
    invalid(`${String(event.type)}.contextUsage`, original);
  }
}

function validateMemoryCompactionInfo(value: Record<string, unknown>, original: unknown): void {
  for (const field of [
    "originalMessageCount",
    "compactedMessageCount",
    "retainedMessageCount",
    "originalTokenCount",
    "compactedTokenCount",
    "retainedTokenCount",
    "resultTokenCount",
  ]) {
    if (!isEventId(value[field])) invalid(`memory_compaction.${field}`, original);
  }
  if (!isPositiveEventId(value.attempts)) invalid("memory_compaction.attempts", original);
  if (!isUsage(value.usage)) invalid("memory_compaction.usage", original);
}

function isTrace(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["observer", "traceId", "observationId"]) &&
    typeof value.observer === "string" &&
    value.observer.trim().length > 0 &&
    (value.traceId === undefined || typeof value.traceId === "string") &&
    (value.observationId === undefined || typeof value.observationId === "string")
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ClientProtocolError(`${label} must be an object.`, value);
  return value;
}

function requireOnlyKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ClientProtocolError(`${label} has unknown field "${key}".`);
  }
}

function requireEventKeys(value: Record<string, unknown>, keys: string[]): void {
  requireOnlyKeys(
    value,
    ["type", "runId", "turn", "scope", ...keys],
    `${String(value.type)} event`,
  );
}

function requireStrings(value: Record<string, unknown>, keys: string[], original: unknown): void {
  for (const key of keys) {
    if (typeof value[key] !== "string") invalid(`${String(value.type)}.${key}`, original);
  }
}

function requireOptionalStrings(
  value: Record<string, unknown>,
  keys: string[],
  original: unknown,
): void {
  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      invalid(`${String(value.type)}.${key}`, original);
    }
  }
}

function requireOneOf(value: unknown, allowed: string[], label: string, original: unknown): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(label, original);
}

function invalid(label: string, value: unknown): never {
  throw new ClientProtocolError(`Invalid ${label}.`, value);
}

function isEventId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveEventId(value: unknown): value is number {
  return isEventId(value) && value > 0;
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
