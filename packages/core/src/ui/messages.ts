import {
  AssistantContent,
  type AssistantContent as AssistantContentType,
  type Message as CoreMessage,
  type JsonValue,
  Message,
  reasoningDisplayText,
  serializeToolResultOutput,
  ToolContent,
  type ToolContent as ToolContentType,
  type ToolResultContent,
  UserContent,
} from "../completion/types";
import type { UIMessage, UIMessagePart } from "./types";

export function uiMessagesToCoreMessages(messages: UIMessage[]): CoreMessage[] {
  const coreMessages: CoreMessage[] = [];

  for (const message of messages) {
    const text = textFromUIParts(message.parts);

    if (message.role === "system") {
      if (text.length > 0) {
        coreMessages.push(Message.system(text));
      }
      continue;
    }

    if (message.role === "user") {
      const content = message.parts
        .filter((part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text")
        .map((part) => UserContent.text(part.text));
      if (content.length > 0) {
        coreMessages.push(Message.user(content));
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: AssistantContentType[] = [];
      for (const part of message.parts) {
        if (part.type === "text" && part.text.length > 0) {
          content.push(AssistantContent.text(part.text));
          continue;
        }
        if (part.type === "reasoning" && part.text.length > 0) {
          content.push(AssistantContent.reasoning(part.text, part.reasoningId));
          continue;
        }
        if (
          part.type === "tool" &&
          (part.state === "input-streaming" || part.state === "input-available")
        ) {
          content.push(
            AssistantContent.toolCall(
              part.toolCallId,
              part.toolName,
              part.input ?? {},
              part.callId,
            ),
          );
        }
      }
      if (content.length > 0) {
        coreMessages.push(Message.assistant(content, message.id));
      }
      continue;
    }

    const toolResults: ToolContentType[] = [];
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state !== "output-available") {
        continue;
      }
      toolResults.push(
        ToolContent.toolResult(
          part.toolCallId,
          outputToToolResultContent(part.output),
          part.callId,
        ),
      );
    }
    if (toolResults.length > 0) {
      coreMessages.push(Message.tool(toolResults));
    }
  }

  return coreMessages;
}

export function coreMessagesToUIMessages(messages: CoreMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      uiMessages.push({
        id: createId("msg"),
        role: "system",
        parts: [{ id: createId("part"), type: "text", text: message.content }],
      });
      continue;
    }

    if (message.role === "user") {
      const parts: UIMessagePart[] = [];
      for (const content of message.content) {
        if (content.type === "text") {
          parts.push({ id: createId("part"), type: "text", text: content.text });
        } else {
          parts.push({
            id: createId("part"),
            type: "data",
            name: content.type,
            data: content as JsonValue,
          });
        }
      }
      uiMessages.push({ id: createId("msg"), role: "user", parts });
      continue;
    }

    if (message.role === "assistant") {
      const parts: UIMessagePart[] = [];
      for (const content of message.content) {
        if (content.type === "text") {
          parts.push({ id: createId("part"), type: "text", text: content.text });
          continue;
        }
        if (content.type === "reasoning") {
          const part: UIMessagePart = {
            id: createId("part"),
            type: "reasoning",
            text: reasoningDisplayText(content),
          };
          if (content.id !== undefined) {
            part.reasoningId = content.id;
          }
          parts.push(part);
          continue;
        }
        if (content.type === "tool_call") {
          const part: UIMessagePart = {
            id: toolPartId(content.id),
            type: "tool",
            toolName: content.function.name,
            toolCallId: content.id,
            state: "input-available",
            input: content.function.arguments,
          };
          if (content.callId !== undefined) {
            part.callId = content.callId;
          }
          parts.push(part);
          continue;
        }
        parts.push({
          id: createId("part"),
          type: "data",
          name: content.type,
          data: content as JsonValue,
        });
      }
      uiMessages.push({ id: message.id ?? createId("msg"), role: "assistant", parts });
      continue;
    }

    const parts: UIMessagePart[] = [];
    for (const content of message.content) {
      const part: UIMessagePart = {
        id: toolPartId(content.id),
        type: "tool",
        toolName: "tool",
        toolCallId: content.id,
        state: "output-available",
        output: toolResultContentToJson(content.content),
      };
      if (content.callId !== undefined) {
        part.callId = content.callId;
      }
      parts.push(part);
    }
    uiMessages.push({ id: createId("msg"), role: "tool", parts });
  }

  return uiMessages;
}

export function isUIMessage(value: unknown): value is UIMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isUIMessageRole(value.role) &&
    Array.isArray(value.parts)
  );
}

export function isUIMessageArray(value: unknown): value is UIMessage[] {
  return Array.isArray(value) && value.every(isUIMessage);
}

function textFromUIParts(parts: UIMessagePart[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function outputToToolResultContent(output: JsonValue | undefined): ToolResultContent[] {
  return [{ type: "text", text: serializeToolResultOutput(output ?? null) }];
}

function toolResultContentToJson(content: ToolResultContent[]): JsonValue {
  if (content.length === 1 && content[0]?.type === "text") {
    return content[0].text;
  }
  return content as JsonValue;
}

function toolPartId(toolCallId: string): string {
  return `tool_${toolCallId}`;
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

function isUIMessageRole(value: unknown): value is UIMessage["role"] {
  return value === "system" || value === "user" || value === "assistant" || value === "tool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
