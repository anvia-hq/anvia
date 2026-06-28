import type { UIMessage, UIMessagePart, UIStreamEvent } from "@anvia/core/ui";
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

  return messages;
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

export function replaceAssistantText(messages: UIMessage[], text: string): UIMessage[] {
  const current = ensureAssistantMessage(messages);
  const assistant = current[current.length - 1];
  if (assistant === undefined) {
    return current;
  }
  return current.map((message) =>
    message.id === assistant.id
      ? {
          ...message,
          parts: [{ id: `${assistant.id}_text`, type: "text", text }],
        }
      : message,
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
