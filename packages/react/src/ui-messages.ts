import type { Message as CoreMessage, JsonValue } from "@anvia/core/completion";
import {
  type CreateUIAttachment,
  coreMessagesToUIMessages,
  type UIAttachment,
  type UIError,
  type UIMessage,
  type UIMessagePart,
  type UIStreamEvent,
} from "@anvia/core/ui";
import type { SendMessageInput } from "./types";

type UIToolMessagePart = Extract<UIMessagePart, { type: "tool" }>;

export function createUserMessage(input: SendMessageInput): UIMessage | undefined {
  if (isUIMessage(input)) {
    return input;
  }

  const text = typeof input === "string" ? input : (input.text ?? "");
  const attachments = typeof input === "string" ? [] : (input.attachments ?? []);
  if (text.trim().length === 0 && attachments.length === 0) {
    return undefined;
  }

  const parts: UIMessagePart[] = [];
  if (text.trim().length > 0) {
    parts.push({ id: createId("part"), type: "text", text });
  }
  for (const attachment of attachments) {
    const normalized = createAttachment(attachment);
    parts.push({
      id: createId("part"),
      type: "attachment",
      attachment: normalized,
    });
  }

  return {
    id: typeof input === "string" || input.id === undefined ? createId("msg") : input.id,
    role: "user",
    parts,
    ...(typeof input === "string" || input.metadata === undefined
      ? {}
      : { metadata: input.metadata }),
  };
}

function createAttachment(attachment: CreateUIAttachment): UIAttachment {
  return {
    ...attachment,
    id: attachment.id ?? createId("attachment"),
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
    const part: UIToolMessagePart = {
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
    const part: UIToolMessagePart = {
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
    const providerCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const internalCallId =
      typeof event.internalCallId === "string" ? event.internalCallId : undefined;
    const toolCallId = providerCallId ?? internalCallId;
    if (toolCallId === undefined || typeof event.toolName !== "string") {
      return undefined;
    }
    const part: UIToolMessagePart = {
      id: toolPartId(toolCallId),
      type: "tool",
      toolName: event.toolName,
      toolCallId,
      ...(providerCallId === undefined ? {} : { callId: providerCallId }),
      state: "output-available",
      output:
        "structuredResult" in event && event.structuredResult !== undefined
          ? valueToJson(event.structuredResult)
          : valueToJson(event.result),
    };
    return updateAssistantToolPart(
      messages,
      part,
      [providerCallId, internalCallId],
      parseJsonValue(event.args),
    );
  }

  if (event.type === "message_id" && typeof event.id === "string") {
    return setLastAssistantMetadata(messages, { providerMessageId: event.id });
  }

  if (event.type === "final") {
    const finalMessages = finalMessagesFromEvent(event);
    if (finalMessages !== undefined) {
      const next = replaceCurrentRunMessages(messages, finalMessages);
      return typeof event.runId === "string"
        ? setLastAssistantMetadata(next, { runId: event.runId })
        : next;
    }

    if (isRecord(event.response) && Array.isArray(event.response.choice)) {
      const finalText = textFromAssistantContent(event.response.choice);
      const next = finalText.length > 0 ? replaceAssistantText(messages, finalText) : messages;
      const providerMessageId = event.response.messageId;
      return typeof providerMessageId === "string"
        ? setLastAssistantMetadata(next, { providerMessageId })
        : next;
    }

    if (typeof event.output === "string") {
      const next =
        event.output.length > 0 ? replaceAssistantText(messages, event.output) : messages;
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

function assistantTextPartId(assistant: UIMessage): string {
  const lastPart = assistant.parts.at(-1);
  if (lastPart?.type === "text") {
    return lastPart.id;
  }

  const textCount = assistant.parts.filter((part) => part.type === "text").length;
  return textCount === 0 ? `${assistant.id}_text` : `${assistant.id}_text_${textCount + 1}`;
}

function assistantReasoningPartId(assistant: UIMessage, reasoningId?: string): string {
  if (reasoningId !== undefined) {
    return `${assistant.id}_reasoning_${reasoningId}`;
  }

  const lastPart = assistant.parts.at(-1);
  if (lastPart?.type === "reasoning" && lastPart.reasoningId === undefined) {
    return lastPart.id;
  }

  const reasoningCount = assistant.parts.filter((part) => part.type === "reasoning").length;
  return reasoningCount === 0
    ? `${assistant.id}_reasoning`
    : `${assistant.id}_reasoning_${reasoningCount + 1}`;
}

export function appendAssistantDelta(messages: UIMessage[], delta: string): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  return updateMessagePart(current, assistant.id, {
    id: assistantTextPartId(assistant),
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
  return updateMessagePart(current, assistant.id, {
    id: assistantReasoningPartId(assistant, reasoningId),
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

function finalMessagesFromEvent(event: Record<string, unknown>): UIMessage[] | undefined {
  if (!Array.isArray(event.messages) || event.messages.length === 0) {
    return undefined;
  }

  try {
    return coreMessagesToUIMessages(event.messages as CoreMessage[]);
  } catch {
    return undefined;
  }
}

function replaceCurrentRunMessages(messages: UIMessage[], finalMessages: UIMessage[]): UIMessage[] {
  if (messages.length === 0 || finalMessages.length === 0) {
    return finalMessages;
  }

  const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
  if (lastUserIndex === -1) {
    return finalMessages;
  }

  const finalFirst = finalMessages[0];
  if (finalFirst?.role !== "user") {
    return [...messages.slice(0, lastUserIndex + 1), ...finalMessages];
  }

  const currentPrompt = messages[lastUserIndex];
  if (currentPrompt === undefined || messageText(currentPrompt) !== messageText(finalFirst)) {
    return finalMessages;
  }

  return [
    ...messages.slice(0, lastUserIndex),
    { ...finalFirst, id: currentPrompt.id },
    ...finalMessages.slice(1),
  ];
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
    } else if (currentPart?.type === "tool" && part.type === "tool") {
      parts[partIndex] = mergeToolPart(currentPart, part);
    } else {
      parts[partIndex] = part;
    }
    return { ...message, parts };
  });
}

function updateAssistantToolPart(
  messages: UIMessage[],
  part: UIToolMessagePart,
  aliases: Array<string | undefined> = [],
  inputMatch?: JsonValue,
): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }

  const existingPart = findMatchingToolPart(assistant, part, aliases, inputMatch);
  const nextPart =
    existingPart === undefined
      ? part
      : {
          ...part,
          id: existingPart.id,
          toolCallId: existingPart.toolCallId,
          ...(existingPart.callId !== undefined
            ? { callId: existingPart.callId }
            : part.callId !== undefined
              ? { callId: part.callId }
              : {}),
        };

  return updateMessagePart(current, assistant.id, nextPart);
}

function findMatchingToolPart(
  message: UIMessage,
  part: UIToolMessagePart,
  aliases: Array<string | undefined>,
  inputMatch?: JsonValue,
): UIToolMessagePart | undefined {
  const candidates = new Set(
    [part.toolCallId, part.callId, ...aliases].filter(
      (candidate): candidate is string => candidate !== undefined && candidate.length > 0,
    ),
  );

  const exactMatch = message.parts.find(
    (item): item is UIToolMessagePart =>
      item.type === "tool" &&
      (item.id === part.id ||
        candidates.has(item.toolCallId) ||
        (item.callId !== undefined && candidates.has(item.callId))),
  );
  if (exactMatch !== undefined || inputMatch === undefined) {
    return exactMatch;
  }

  const inputMatches = message.parts.filter(
    (item): item is UIToolMessagePart =>
      item.type === "tool" &&
      item.toolName === part.toolName &&
      item.state !== "output-available" &&
      item.state !== "error" &&
      jsonEquals(item.input ?? {}, inputMatch),
  );
  return inputMatches.length === 1 ? inputMatches[0] : undefined;
}

function mergeToolPart(
  currentPart: UIToolMessagePart,
  nextPart: UIToolMessagePart,
): UIToolMessagePart {
  const merged: UIToolMessagePart = { ...currentPart, ...nextPart };

  if (nextPart.toolName.length === 0) {
    merged.toolName = currentPart.toolName;
  }
  if (nextPart.callId === undefined && currentPart.callId !== undefined) {
    merged.callId = currentPart.callId;
  }
  if (nextPart.input === undefined && currentPart.input !== undefined) {
    merged.input = currentPart.input;
  } else if (typeof currentPart.input === "string" && typeof nextPart.input === "string") {
    merged.input = `${currentPart.input}${nextPart.input}`;
  }
  if (nextPart.output === undefined && currentPart.output !== undefined) {
    merged.output = currentPart.output;
  }
  if (nextPart.error === undefined && currentPart.error !== undefined) {
    merged.error = currentPart.error;
  }

  return merged;
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

function parseJsonValue(value: unknown): JsonValue | undefined {
  if (typeof value === "string") {
    try {
      return valueToJson(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value === undefined) {
    return undefined;
  }
  return valueToJson(value);
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

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  try {
    return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
  } catch {
    return false;
  }
}

function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
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

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) {
      return index;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
