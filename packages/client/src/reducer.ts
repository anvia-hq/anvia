import { isJsonValue, type JsonObject } from "@anvia/core/completion";
import { createClientId } from "./messages";
import type {
  ClientDataMap,
  ClientStreamEvent,
  UIMessage,
  UIMessageGeneration,
  UIMessagePart,
  UIToolMessagePart,
} from "./types";

export function applyClientStreamEvent<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  event: ClientStreamEvent<Metadata, Data>,
): readonly UIMessage<Metadata, Data>[] {
  if (event.scope?.parentToolCallId !== undefined) {
    return messages;
  }

  switch (event.type) {
    case "message_start": {
      if (messages.some((message) => message.id === event.messageId)) return messages;
      let message: UIMessage<Metadata, Data> = {
        id: event.messageId,
        role: event.role,
        parts: [],
      };
      if (event.metadata !== undefined) message = { ...message, metadata: event.metadata };
      return [...messages, message];
    }
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
    case "reasoning_start": {
      const reasoning: Extract<UIMessagePart, { type: "reasoning" }> = {
        id: event.partId,
        type: "reasoning",
        text: "",
      };
      if (event.reasoningId !== undefined) reasoning.reasoningId = event.reasoningId;
      return upsertPart(messages, event.messageId, reasoning);
    }
    case "reasoning_delta":
      return updatePart(messages, event.messageId, event.partId, (part) => {
        const reasoning: Extract<UIMessagePart, { type: "reasoning" }> = {
          id: event.partId,
          type: "reasoning",
          text: part?.type === "reasoning" ? `${part.text}${event.delta}` : event.delta,
        };
        if (part?.type === "reasoning" && part.reasoningId !== undefined) {
          reasoning.reasoningId = part.reasoningId;
        }
        const content = appendReasoningContent(
          part?.type === "reasoning" ? part.content : undefined,
          event,
        );
        if (content !== undefined) reasoning.content = content;
        return reasoning;
      });
    case "reasoning_end":
      return updatePart(messages, event.messageId, event.partId, (part) => {
        const reasoning: Extract<UIMessagePart, { type: "reasoning" }> = {
          id: event.partId,
          type: "reasoning",
          text: event.text ?? (part?.type === "reasoning" ? part.text : ""),
        };
        if (part?.type === "reasoning" && part.reasoningId !== undefined) {
          reasoning.reasoningId = part.reasoningId;
        }
        if (event.content !== undefined) {
          reasoning.content = event.content;
        } else if (part?.type === "reasoning" && part.content !== undefined) {
          reasoning.content = part.content;
        }
        return reasoning;
      });
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
        const part =
          current?.type === "tool"
            ? toolPartBase(current)
            : {
                id: event.partId,
                type: "tool" as const,
                toolName: event.toolName ?? "",
                toolCallId: event.toolCallId,
              };
        const previous =
          current?.type === "tool" && typeof current.input === "string" ? current.input : "";
        if (event.toolName !== undefined) part.toolName = event.toolName;
        if (event.callId !== undefined) part.callId = event.callId;
        if (event.signature !== undefined) part.signature = event.signature;
        if (event.turn !== undefined) part.turn = event.turn;
        return {
          ...part,
          state: "input-streaming",
          input: event.mode === "replace" ? event.delta : `${previous}${event.delta}`,
        };
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
      return upsertPart(messages, event.messageId, part);
    }
    case "tool_result":
      return updatePart(messages, event.messageId, event.partId, (current) => {
        const part =
          current?.type === "tool"
            ? toolPartBase(current)
            : {
                id: event.partId,
                type: "tool" as const,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
              };
        if (event.callId !== undefined) part.callId = event.callId;
        if (event.internalCallId !== undefined) part.internalCallId = event.internalCallId;
        if (event.turn !== undefined) part.turn = event.turn;
        if (event.result.status === "error") {
          return {
            ...part,
            state: "error",
            input: event.input,
            error: event.result.error,
          };
        }
        const completed: Extract<UIToolMessagePart, { state: "output-available" }> = {
          ...part,
          state: "output-available",
          input: event.input,
          output: event.result.output,
        };
        if (event.result.content !== undefined) completed.resultContent = event.result.content;
        return completed;
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
      } as UIMessagePart<Data>);
    case "message_end":
      return messages.map((message) => {
        if (message.id !== event.messageId) return message;
        const metadata = mergeMetadata(message.metadata, event.metadata);
        const generationUpdate: UIMessageGeneration = {
          runId: event.runId,
        };
        if (event.usage !== undefined) generationUpdate.usage = event.usage;
        if (event.contextUsage !== undefined) {
          generationUpdate.contextUsage = event.contextUsage;
        }
        const generation = mergeGeneration(message.generation, generationUpdate);
        let updated: UIMessage<Metadata, Data> = {
          ...message,
          generation,
        };
        if (event.parts !== undefined) {
          updated = { ...updated, parts: reconcileFinalParts(message.parts, event.parts) };
        }
        if (event.modelMessageId !== undefined) {
          updated = { ...updated, modelMessageId: event.modelMessageId };
        }
        if (metadata !== undefined) updated = { ...updated, metadata };
        return updated;
      });
    case "run_end": {
      const generation: UIMessageGeneration = {
        runId: event.runId,
        status: event.status,
      };
      if (event.contextUsage !== undefined) generation.contextUsage = event.contextUsage;
      if (event.trace !== undefined) generation.trace = event.trace;
      if (event.memoryCompaction !== undefined) {
        generation.memoryCompaction = event.memoryCompaction;
      }
      return updateLastAssistantGeneration(messages, generation);
    }
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

function toolPartBase(
  part: UIToolMessagePart,
): Omit<UIToolMessagePart, "state" | "input" | "output" | "resultContent" | "error"> {
  const base = {
    id: part.id,
    type: part.type,
    toolName: part.toolName,
    toolCallId: part.toolCallId,
  };
  if (part.callId !== undefined) Object.assign(base, { callId: part.callId });
  if (part.internalCallId !== undefined) {
    Object.assign(base, { internalCallId: part.internalCallId });
  }
  if (part.turn !== undefined) Object.assign(base, { turn: part.turn });
  if (part.signature !== undefined) Object.assign(base, { signature: part.signature });
  return base;
}

function reconcileFinalParts<Data extends ClientDataMap>(
  current: readonly UIMessagePart<Data>[],
  final: readonly UIMessagePart<Data>[],
): UIMessagePart<Data>[] {
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
      let detail: Extract<
        NonNullable<Extract<UIMessagePart, { type: "reasoning" }>["content"]>[number],
        { type: "text" }
      > = {
        type,
        text: event.delta,
      };
      if (event.signature !== undefined) detail = { ...detail, signature: event.signature };
      next.push(detail);
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

export function messageText<Metadata extends JsonObject, Data extends ClientDataMap>(
  message: UIMessage<Metadata, Data>,
): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function assistantText<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  return assistant === undefined ? "" : messageText(assistant);
}

function upsertPart<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  messageId: string,
  part: UIMessagePart<Data>,
): readonly UIMessage<Metadata, Data>[] {
  return updatePart(messages, messageId, part.id, () => part);
}

function updatePart<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  messageId: string,
  partId: string,
  update: (part: UIMessagePart<Data> | undefined) => UIMessagePart<Data>,
): readonly UIMessage<Metadata, Data>[] {
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

function ensureAssistant<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  messageId: string,
): readonly UIMessage<Metadata, Data>[] {
  return messages.some((message) => message.id === messageId)
    ? messages
    : [...messages, { id: messageId, role: "assistant", parts: [] }];
}

function appendToLastAssistant<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  part: UIMessagePart<Data>,
): readonly UIMessage<Metadata, Data>[] {
  const index = findLastIndex(messages, (message) => message.role === "assistant");
  if (index === -1) {
    return [...messages, { id: createClientId("msg"), role: "assistant", parts: [part] }];
  }
  const next = [...messages];
  const message = next[index] as UIMessage<Metadata, Data>;
  next[index] = { ...message, parts: [...message.parts, part] };
  return next;
}

function updateLastAssistantGeneration<Metadata extends JsonObject, Data extends ClientDataMap>(
  messages: readonly UIMessage<Metadata, Data>[],
  value: UIMessageGeneration,
): readonly UIMessage<Metadata, Data>[] {
  const index = findLastIndex(messages, (message) => message.role === "assistant");
  if (index === -1) return messages;
  const next = [...messages];
  const message = next[index] as UIMessage<Metadata, Data>;
  next[index] = { ...message, generation: mergeGeneration(message.generation, value) };
  return next;
}

function mergeMetadata<Metadata extends JsonObject>(
  current: Metadata | undefined,
  provided: Metadata | undefined,
): Metadata | undefined {
  if (provided === undefined) return current;
  if (!isRecord(current) || !isRecord(provided)) return provided;
  const next = { ...current, ...provided };
  return isJsonValue(next) ? (next as Metadata) : provided;
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

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
