import type { JsonValue } from "@anvia/core/completion";
import type { UIError, UIMessage, UIMessagePart, UIStreamEvent } from "@anvia/core/ui";
import type { SendMessageInput } from "./types";

export function createUserMessage(input: SendMessageInput): UIMessage | undefined {
  if (isUIMessage(input)) {
    return input;
  }

  const text = typeof input === "string" ? input : input.text;
  if (text.trim().length === 0) {
    return undefined;
  }

  return {
    id: typeof input === "string" || input.id === undefined ? createId("msg") : input.id,
    role: "user",
    parts: [{ id: createId("part"), type: "text", text }],
    ...(typeof input === "string" || input.metadata === undefined
      ? {}
      : { metadata: input.metadata }),
  };
}

export function applyUIStreamEvent(messages: UIMessage[], event: UIStreamEvent): UIMessage[] {
  if (event.type === "message_start") {
    const index = messages.findIndex((message) => message.id === event.message.id);
    if (index === -1) {
      return [...messages, event.message];
    }
    const next = [...messages];
    next[index] = event.message;
    return next;
  }

  if (event.type === "text_delta") {
    return updateMessagePart(messages, event.messageId, {
      id: event.partId,
      type: "text",
      text: event.delta,
    });
  }

  if (event.type === "reasoning_delta") {
    return updateMessagePart(messages, event.messageId, {
      id: event.partId,
      type: "reasoning",
      text: event.delta,
    });
  }

  if (event.type === "tool_update") {
    return updateMessagePart(messages, event.messageId, event.part);
  }

  if (event.type === "error") {
    const messageId = createId("msg");
    return [
      ...messages,
      {
        id: messageId,
        role: "assistant",
        parts: [{ id: createId("part"), type: "error", error: event.error }],
      },
    ];
  }

  if (event.type === "message_end") {
    const { metadata } = event;
    if (metadata === undefined) {
      return messages;
    }

    return messages.map((message) =>
      message.id === event.messageId ? { ...message, metadata } : message,
    );
  }

  return messages;
}

export function applyAnviaStreamEvent(
  messages: UIMessage[],
  event: unknown,
): UIMessage[] | undefined {
  const uiEvent = asUIStreamEvent(event);
  if (uiEvent !== undefined) {
    return applyUIStreamEvent(messages, uiEvent);
  }

  if (!isRecord(event) || typeof event.type !== "string") {
    return undefined;
  }

  if (event.type === "text_delta" && typeof event.delta === "string") {
    return appendAssistantDelta(messages, event.delta);
  }

  if (event.type === "reasoning_delta" && typeof event.delta === "string") {
    return appendAssistantReasoningDelta(
      messages,
      event.delta,
      typeof event.id === "string" ? event.id : undefined,
    );
  }

  if (event.type === "tool_call_delta" && typeof event.id === "string") {
    const part: UIMessagePart = {
      id: toolPartId(event.id),
      type: "tool",
      toolName: typeof event.name === "string" ? event.name : "",
      toolCallId: event.id,
      ...(typeof event.callId === "string" ? { callId: event.callId } : {}),
      state: "input-streaming",
      ...(typeof event.argumentsDelta === "string" ? { input: event.argumentsDelta } : {}),
    };
    return updateAssistantToolPart(messages, part);
  }

  if (event.type === "tool_call" && isToolCall(event.toolCall)) {
    const part: UIMessagePart = {
      id: toolPartId(event.toolCall.id),
      type: "tool",
      toolName: event.toolCall.function.name,
      toolCallId: event.toolCall.id,
      ...(typeof event.toolCall.callId === "string" ? { callId: event.toolCall.callId } : {}),
      state: "input-available",
      input: event.toolCall.function.arguments,
    };
    return updateAssistantToolPart(messages, part);
  }

  if (event.type === "tool_result") {
    const toolCallId =
      typeof event.toolCallId === "string"
        ? event.toolCallId
        : typeof event.internalCallId === "string"
          ? event.internalCallId
          : undefined;
    if (toolCallId === undefined || typeof event.toolName !== "string") {
      return undefined;
    }
    const part: UIMessagePart = {
      id: toolPartId(toolCallId),
      type: "tool",
      toolName: event.toolName,
      toolCallId,
      ...(typeof event.toolCallId === "string" ? { callId: event.toolCallId } : {}),
      state: "output-available",
      output: Array.isArray(event.structuredResult)
        ? (event.structuredResult as JsonValue)
        : valueToJson(event.result),
    };
    return updateAssistantToolPart(messages, part);
  }

  if (event.type === "message_id" && typeof event.id === "string") {
    return setLastAssistantMetadata(messages, { providerMessageId: event.id });
  }

  if (event.type === "final") {
    if (isRecord(event.response) && Array.isArray(event.response.choice)) {
      const next = replaceAssistantText(messages, textFromAssistantContent(event.response.choice));
      const providerMessageId = event.response.messageId;
      return typeof providerMessageId === "string"
        ? setLastAssistantMetadata(next, { providerMessageId })
        : next;
    }

    if (typeof event.output === "string") {
      const next = replaceAssistantText(messages, event.output);
      return typeof event.runId === "string"
        ? setLastAssistantMetadata(next, { runId: event.runId })
        : next;
    }
  }

  if (event.type === "error" && "error" in event) {
    return appendAssistantError(messages, errorFromUnknown(event.error));
  }

  return undefined;
}

export function assistantText(messages: UIMessage[]): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (assistant === undefined) {
    return "";
  }
  return messageText(assistant);
}

export function messageText(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function appendAssistantDelta(messages: UIMessage[], delta: string): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  return updateMessagePart(current, assistant.id, {
    id: `${assistant.id}_text`,
    type: "text",
    text: delta,
  });
}

export function appendAssistantReasoningDelta(
  messages: UIMessage[],
  delta: string,
  reasoningId?: string,
): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  const partId =
    reasoningId === undefined
      ? `${assistant.id}_reasoning`
      : `${assistant.id}_reasoning_${reasoningId}`;
  return updateMessagePart(current, assistant.id, {
    id: partId,
    type: "reasoning",
    text: delta,
    ...(reasoningId === undefined ? {} : { reasoningId }),
  });
}

export function replaceAssistantText(messages: UIMessage[], text: string): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  return current.map((message) =>
    message.id === assistant.id ? { ...message, parts: replaceTextPart(message, text) } : message,
  );
}

function updateMessagePart(
  messages: UIMessage[],
  messageId: string,
  part: UIMessagePart,
): UIMessage[] {
  const existingMessage = messages.find((message) => message.id === messageId);
  const current =
    existingMessage === undefined
      ? [...messages, { id: messageId, role: "assistant" as const, parts: [] }]
      : messages;

  return current.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    const partIndex = message.parts.findIndex((item) => item.id === part.id);
    if (partIndex === -1) {
      return { ...message, parts: [...message.parts, part] };
    }

    const parts = [...message.parts];
    const currentPart = parts[partIndex];
    if (
      (currentPart?.type === "text" && part.type === "text") ||
      (currentPart?.type === "reasoning" && part.type === "reasoning")
    ) {
      parts[partIndex] = { ...currentPart, text: `${currentPart.text}${part.text}` };
    } else {
      parts[partIndex] = part;
    }
    return { ...message, parts };
  });
}

function updateAssistantToolPart(messages: UIMessage[], part: UIMessagePart): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  return assistant === undefined ? current : updateMessagePart(current, assistant.id, part);
}

function appendAssistantError(messages: UIMessage[], error: UIError): UIMessage[] {
  const messageId = createId("msg");
  return [
    ...messages,
    {
      id: messageId,
      role: "assistant",
      parts: [{ id: createId("part"), type: "error", error }],
    },
  ];
}

function setLastAssistantMetadata(messages: UIMessage[], metadata: JsonValue): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  return current.map((message) =>
    message.id === assistant.id
      ? { ...message, metadata: mergeMetadata(message.metadata, metadata) }
      : message,
  );
}

function replaceTextPart(message: UIMessage, text: string): UIMessagePart[] {
  const index = message.parts.findIndex((part) => part.type === "text");
  if (index === -1) {
    return [...message.parts, { id: `${message.id}_text`, type: "text", text }];
  }
  const parts = [...message.parts];
  const current = parts[index];
  if (current?.type === "text") {
    parts[index] = { ...current, text };
  }
  return parts;
}

function ensureAssistantMessage(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    return messages;
  }

  return [
    ...messages,
    {
      id: createId("msg"),
      role: "assistant",
      parts: [],
    },
  ];
}

let nextId = 0;

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random !== undefined) {
    return `${prefix}_${random}`;
  }
  nextId += 1;
  return `${prefix}_${nextId.toString(36)}`;
}

function isUIMessage(input: SendMessageInput): input is UIMessage {
  return typeof input !== "string" && "role" in input && Array.isArray(input.parts);
}

function asUIStreamEvent(event: unknown): UIStreamEvent | undefined {
  if (!isRecord(event) || typeof event.type !== "string") {
    return undefined;
  }

  if (event.type === "message_start" && isStreamMessage(event.message)) {
    return event as UIStreamEvent;
  }
  if (
    (event.type === "text_delta" || event.type === "reasoning_delta") &&
    typeof event.messageId === "string" &&
    typeof event.partId === "string" &&
    typeof event.delta === "string"
  ) {
    return event as UIStreamEvent;
  }
  if (
    event.type === "tool_update" &&
    typeof event.messageId === "string" &&
    typeof event.partId === "string" &&
    isUIMessagePart(event.part)
  ) {
    return event as UIStreamEvent;
  }
  if (event.type === "message_end" && typeof event.messageId === "string") {
    return event as UIStreamEvent;
  }
  if (event.type === "error" && isUIError(event.error)) {
    return event as UIStreamEvent;
  }
  return undefined;
}

function isStreamMessage(value: unknown): value is UIMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.role === "string" &&
    Array.isArray(value.parts)
  );
}

function isUIMessagePart(value: unknown): value is UIMessagePart {
  return isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
}

function isUIError(value: unknown): value is UIError {
  return isRecord(value) && typeof value.message === "string";
}

function isToolCall(value: unknown): value is {
  id: string;
  callId?: string;
  function: { name: string; arguments: JsonValue };
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.function) &&
    typeof value.function.name === "string" &&
    "arguments" in value.function
  );
}

function textFromAssistantContent(content: unknown[]): string {
  return content
    .flatMap((item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [],
    )
    .join("\n");
}

function errorFromUnknown(error: unknown): UIError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: typeof error === "string" ? error : stringifyUnknown(error) };
}

function stringifyUnknown(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function valueToJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isRecord(value)
  ) {
    return value as JsonValue;
  }
  return stringifyUnknown(value);
}

function mergeMetadata(current: UIMessage["metadata"], next: JsonValue): JsonValue {
  if (isJsonObject(current) && isJsonObject(next)) {
    return { ...current, ...next };
  }
  return next;
}

function isJsonObject(value: unknown): value is Record<string, JsonValue | undefined> {
  return isRecord(value) && !Array.isArray(value);
}

function toolPartId(toolCallId: string): string {
  return `tool_${toolCallId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
