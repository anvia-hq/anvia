import {
  type AssistantContent as AnviaAssistantContent,
  type Message as AnviaMessage,
  AssistantContent,
  type JsonValue,
  Message,
  ToolContent,
} from "@anvia/core/completion";
import type { AssistantMessage, ChatMessage } from "./types.js";

export function toAnviaHistory(messages: ChatMessage[]) {
  return messages.flatMap((message) =>
    message.role === "user" ? [Message.user(message.content)] : assistantHistory(message),
  );
}

function assistantHistory(message: AssistantMessage) {
  const history: AnviaMessage[] = [];
  let assistantContent: AnviaAssistantContent[] = [];

  const flushAssistantContent = () => {
    if (assistantContent.length === 0) {
      return;
    }

    history.push(Message.assistant(assistantContent));
    assistantContent = [];
  };

  for (const part of message.parts) {
    if (part.type === "text") {
      assistantContent.push(AssistantContent.text(part.content));
      continue;
    }

    if (part.type === "reasoning") {
      assistantContent.push(AssistantContent.reasoning(part.content));
      continue;
    }

    if (part.type === "tool_call") {
      assistantContent.push(
        AssistantContent.toolCall(part.id, part.toolName, toJsonValue(part.args), part.callId),
      );
      continue;
    }

    if (part.type === "tool_result") {
      flushAssistantContent();
      history.push(Message.tool(ToolContent.toolResult(part.id, part.result, part.callId)));
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
    return String(value);
  }

  return JSON.parse(serialized) as JsonValue;
}
