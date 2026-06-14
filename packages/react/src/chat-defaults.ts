import type { ChatMessage, ChatRole, DefaultChatRequest } from "./types";

export function defaultCreateRequest<TRequest, TMessage extends ChatMessage>(
  input: string,
  messages: TMessage[],
): TRequest {
  return {
    message: input,
    history: messages.slice(0, -1),
    stream: true,
  } as DefaultChatRequest as TRequest;
}

export function createMessage<TMessage extends ChatMessage>(
  role: ChatRole,
  content: string,
): TMessage {
  return {
    id: createId(),
    role,
    content,
  } as TMessage;
}

export function defaultEventToDelta<TEvent>(event: TEvent): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  return event.type === "text_delta" && typeof event.delta === "string" ? event.delta : undefined;
}

export function defaultEventToFinal<TEvent>(event: TEvent): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  return event.type === "final" && typeof event.output === "string" ? event.output : undefined;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
