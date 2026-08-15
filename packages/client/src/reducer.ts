import { isJsonValue } from "@anvia/core/completion";
import { createClientId } from "./messages";
import type {
  ClientDataMap,
  ClientStreamEvent,
  UIMessage,
  UIMessageGeneration,
  UIMessagePart,
  UIToolMessagePart,
} from "./types";

export function applyClientStreamEvent<TData extends ClientDataMap>(
  messages: UIMessage[],
  event: ClientStreamEvent<TData>,
): UIMessage[] {
  if (event.scope?.parentToolCallId !== undefined) {
    return messages;
  }

  switch (event.type) {
    case "message_start":
      return messages.some((message) => message.id === event.messageId)
        ? messages
        : [
            ...messages,
            {
              id: event.messageId,
              role: event.role,
              parts: [],
              ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
            },
          ];
    case "text_start":
      return upsertPart(messages, event.messageId, {
        id: event.partId,
        type: "text",
        text: "",
      });
    case "text_delta":
      return updatePart(messages, event.messageId, event.partId, (part) => ({
        id: event.partId,
        type: "text",
        text: part?.type === "text" ? `${part.text}${event.delta}` : event.delta,
      }));
    case "text_end":
      return updatePart(messages, event.messageId, event.partId, (part) => {
        const next: Extract<UIMessagePart, { type: "text" }> = {
          id: event.partId,
          type: "text",
          text: event.text ?? (part?.type === "text" ? part.text : ""),
        };
        if (event.signature !== undefined) next.signature = event.signature;
        return next;
      });
    case "reasoning_start":
      return upsertPart(messages, event.messageId, {
        id: event.partId,
        type: "reasoning",
        text: "",
        ...(event.reasoningId === undefined ? {} : { reasoningId: event.reasoningId }),
      });
    case "reasoning_delta":
      return updatePart(messages, event.messageId, event.partId, (part) => {
        const reasoning: Extract<UIMessagePart, { type: "reasoning" }> = {
          id: event.partId,
          type: "reasoning",
          text: part?.type === "reasoning" ? `${part.text}${event.delta}` : event.delta,
          ...(part?.type === "reasoning" && part.reasoningId !== undefined
            ? { reasoningId: part.reasoningId }
            : {}),
        };
        const content = appendReasoningContent(
          part?.type === "reasoning" ? part.content : undefined,
          event,
        );
        if (content !== undefined) reasoning.content = content;
        return reasoning;
      });
    case "reasoning_end":
      return updatePart(messages, event.messageId, event.partId, (part) => ({
        id: event.partId,
        type: "reasoning",
        text: event.text ?? (part?.type === "reasoning" ? part.text : ""),
        ...(part?.type === "reasoning" && part.reasoningId !== undefined
          ? { reasoningId: part.reasoningId }
          : {}),
        ...(event.content !== undefined
          ? { content: event.content }
          : part?.type === "reasoning" && part.content !== undefined
            ? { content: part.content }
            : {}),
      }));
    case "tool_call_start": {
      const part: UIToolMessagePart = {
        id: event.partId,
        type: "tool",
        toolName: event.toolName ?? "",
        toolCallId: event.toolCallId,
        state: "input-streaming",
        input: "",
      };
      if (event.callId !== undefined) part.callId = event.callId;
      if (event.turn !== undefined) part.turn = event.turn;
      return upsertPart(messages, event.messageId, part);
    }
    case "tool_call_delta":
      return updatePart(messages, event.messageId, event.partId, (current) => {
        const part: UIToolMessagePart =
          current?.type === "tool"
            ? { ...current }
            : {
                id: event.partId,
                type: "tool",
                toolName: event.toolName ?? "",
                toolCallId: event.toolCallId,
                state: "input-streaming",
              };
        const previous = typeof part.input === "string" ? part.input : "";
        part.input = event.mode === "replace" ? event.delta : `${previous}${event.delta}`;
        part.state = "input-streaming";
        if (event.toolName !== undefined) part.toolName = event.toolName;
        if (event.callId !== undefined) part.callId = event.callId;
        if (event.signature !== undefined) part.signature = event.signature;
        if (event.turn !== undefined) part.turn = event.turn;
        return part;
      });
    case "tool_call_end": {
      const part: UIToolMessagePart = {
        id: event.partId,
        type: "tool",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        state: "input-available",
        input: event.input,
      };
      if (event.callId !== undefined) part.callId = event.callId;
      if (event.turn !== undefined) part.turn = event.turn;
      if (event.signature !== undefined) part.signature = event.signature;
      if (event.additionalParams !== undefined) part.additionalParams = event.additionalParams;
      return upsertPart(messages, event.messageId, part);
    }
    case "tool_result":
      return updatePart(messages, event.messageId, event.partId, (current) => {
        const part: UIToolMessagePart =
          current?.type === "tool"
            ? { ...current }
            : {
                id: event.partId,
                type: "tool",
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                state: "input-available",
              };
        if (event.callId !== undefined) part.callId = event.callId;
        if (event.internalCallId !== undefined) part.internalCallId = event.internalCallId;
        if (event.input !== undefined) part.input = event.input;
        if (event.turn !== undefined) part.turn = event.turn;
        if (event.result.status === "error") {
          part.state = "error";
          part.error = event.result.error;
        } else {
          part.state = "output-available";
          part.output = event.result.output;
          if (event.result.content !== undefined) part.resultContent = event.result.content;
        }
        return part;
      });
    case "source":
      return upsertPart(messages, event.messageId, {
        id: event.partId,
        type: "source",
        source: event.source,
      });
    case "attachment":
      return upsertPart(messages, event.messageId, {
        id: event.partId,
        type: "attachment",
        attachment: event.attachment,
      });
    case "data":
      if (event.transient === true) return messages;
      return appendToLastAssistant(messages, {
        id: createClientId("data"),
        type: "data",
        name: event.name,
        data: event.data,
      });
    case "message_end":
      return messages.map((message) => {
        if (message.id !== event.messageId) return message;
        const metadata = mergeMetadata(message.metadata, event.metadata);
        const generation = mergeGeneration(message.generation, {
          runId: event.runId,
          ...(event.usage === undefined ? {} : { usage: event.usage }),
          ...(event.contextUsage === undefined ? {} : { contextUsage: event.contextUsage }),
        });
        return {
          ...message,
          ...(event.parts === undefined
            ? {}
            : { parts: reconcileFinalParts(message.parts, event.parts) }),
          ...(event.modelMessageId === undefined ? {} : { modelMessageId: event.modelMessageId }),
          ...(metadata === undefined ? {} : { metadata }),
          generation,
        };
      });
    case "run_end":
      return updateLastAssistantGeneration(messages, {
        runId: event.runId,
        status: event.status,
        ...(event.usage === undefined ? {} : { usage: event.usage }),
        ...(event.contextUsage === undefined ? {} : { contextUsage: event.contextUsage }),
        ...(event.trace === undefined ? {} : { trace: event.trace }),
      });
    case "error":
      return appendToLastAssistant(messages, {
        id: createClientId("error"),
        type: "error",
        error: event.error,
      });
    default:
      return messages;
  }
}

function reconcileFinalParts(current: UIMessagePart[], final: UIMessagePart[]): UIMessagePart[] {
  const clientOnly = current.filter(
    (part) => part.type === "source" || part.type === "data" || part.type === "error",
  );
  return [...final, ...clientOnly];
}

function appendReasoningContent(
  current: Extract<UIMessagePart, { type: "reasoning" }>["content"],
  event: Extract<ClientStreamEvent, { type: "reasoning_delta" }>,
): Extract<UIMessagePart, { type: "reasoning" }>["content"] {
  if (event.contentType === undefined && event.signature === undefined) return current;
  const type = event.contentType ?? "text";
  const next = [...(current ?? [])];
  const last = next.at(-1);
  if (type === "text") {
    if (last?.type === "text" && last.signature === event.signature) {
      next[next.length - 1] = { ...last, text: `${last.text}${event.delta}` };
    } else {
      next.push({
        type,
        text: event.delta,
        ...(event.signature === undefined ? {} : { signature: event.signature }),
      });
    }
    return next;
  }
  if (type === "summary") {
    if (last?.type === "summary") {
      next[next.length - 1] = { ...last, text: `${last.text}${event.delta}` };
    } else next.push({ type, text: event.delta });
    return next;
  }
  if (type === "encrypted") {
    if (last?.type === "encrypted") {
      next[next.length - 1] = { ...last, data: `${last.data}${event.delta}` };
    } else next.push({ type, data: event.delta });
    return next;
  }
  if (last?.type === "redacted") {
    next[next.length - 1] = { ...last, data: `${last.data}${event.delta}` };
  } else next.push({ type, data: event.delta });
  return next;
}

export function messageText(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function assistantText(messages: UIMessage[]): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  return assistant === undefined ? "" : messageText(assistant);
}

function upsertPart(messages: UIMessage[], messageId: string, part: UIMessagePart): UIMessage[] {
  return updatePart(messages, messageId, part.id, () => part);
}

function updatePart(
  messages: UIMessage[],
  messageId: string,
  partId: string,
  update: (part: UIMessagePart | undefined) => UIMessagePart,
): UIMessage[] {
  const current = ensureAssistant(messages, messageId);
  return current.map((message) => {
    if (message.id !== messageId) return message;
    const index = message.parts.findIndex((part) => part.id === partId);
    if (index === -1) return { ...message, parts: [...message.parts, update(undefined)] };
    const parts = [...message.parts];
    parts[index] = update(parts[index]);
    return { ...message, parts };
  });
}

function ensureAssistant(messages: UIMessage[], messageId: string): UIMessage[] {
  return messages.some((message) => message.id === messageId)
    ? messages
    : [...messages, { id: messageId, role: "assistant", parts: [] }];
}

function appendToLastAssistant(messages: UIMessage[], part: UIMessagePart): UIMessage[] {
  const index = findLastIndex(messages, (message) => message.role === "assistant");
  if (index === -1) {
    return [...messages, { id: createClientId("msg"), role: "assistant", parts: [part] }];
  }
  const next = [...messages];
  const message = next[index] as UIMessage;
  next[index] = { ...message, parts: [...message.parts, part] };
  return next;
}

function updateLastAssistantGeneration(
  messages: UIMessage[],
  value: UIMessageGeneration,
): UIMessage[] {
  const index = findLastIndex(messages, (message) => message.role === "assistant");
  if (index === -1) return messages;
  const next = [...messages];
  const message = next[index] as UIMessage;
  next[index] = { ...message, generation: mergeGeneration(message.generation, value) };
  return next;
}

function mergeMetadata(
  current: UIMessage["metadata"],
  provided: UIMessage["metadata"],
): UIMessage["metadata"] {
  if (provided === undefined) return current;
  if (!isRecord(current) || !isRecord(provided)) return provided;
  const next = { ...current, ...provided };
  return isJsonValue(next) ? next : provided;
}

function mergeGeneration(
  current: UIMessageGeneration | undefined,
  provided: UIMessageGeneration,
): UIMessageGeneration {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(provided).filter(([, value]) => value !== undefined)),
  };
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
