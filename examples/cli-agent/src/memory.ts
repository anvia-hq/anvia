import type {
  Message as AnviaMessage,
  AssistantContentPart,
  JsonValue,
} from "@anvia/core/completion";
import type { AssistantMessage, ChatMessage } from "./types.js";

export function toAnviaHistory(messages: ChatMessage[]) {
  return messages.flatMap((message) =>
    message.role === "user"
      ? [{ role: "user" as const, content: message.content }]
      : assistantHistory(message),
  );
}

function assistantHistory(message: AssistantMessage) {
  const history: AnviaMessage[] = [];
  let assistantContent: AssistantContentPart[] = [];

  const flushAssistantContent = () => {
    if (assistantContent.length === 0) {
      return;
    }

    history.push({ role: "assistant", content: assistantContent });
    assistantContent = [];
  };

  for (const part of message.parts) {
    if (part.type === "text") {
      assistantContent.push({ type: "text", text: part.content });
      continue;
    }

    if (part.type === "reasoning") {
      assistantContent.push({ type: "reasoning", text: part.content });
      continue;
    }

    if (part.type === "tool_call") {
      assistantContent.push({
        type: "tool-call",
        toolCallId: part.id,
        toolName: part.toolName,
        input: toJsonValue(part.args),
        ...(part.callId === undefined ? {} : { callId: part.callId }),
      });
      continue;
    }

    if (part.type === "tool_result") {
      flushAssistantContent();
      history.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: part.id,
            toolName: part.toolName,
            output: { type: "text", value: part.result },
            ...(part.callId === undefined ? {} : { callId: part.callId }),
          },
        ],
      });
    }
  }

  flushAssistantContent();

  return history;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return {};
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Tool input must be JSON-serializable.");
  }

  return JSON.parse(serialized) as JsonValue;
}
