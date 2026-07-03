import {
  AssistantContent,
  type AssistantContent as AssistantContentType,
  type Message as CoreMessage,
  type DocumentContent,
  type ImageContent,
  type ImageDetail,
  type JsonValue,
  Message,
  reasoningDisplayText,
  serializeToolResultOutput,
  ToolContent,
  type ToolContent as ToolContentType,
  type ToolResultContent,
  UserContent,
  type UserContent as UserContentType,
} from "../completion/types";
import type { UIAttachment, UIMessage, UIMessagePart } from "./types";

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
      const content: UserContentType[] = [];
      for (const part of message.parts) {
        if (part.type === "text") {
          content.push(UserContent.text(part.text));
          continue;
        }
        if (part.type === "attachment") {
          content.push(attachmentToUserContent(part.attachment));
          continue;
        }
        if (part.type === "data" && isUserContent(part.data)) {
          content.push(part.data);
          continue;
        }
        throw new TypeError(
          "User UI messages can only be converted from text, attachment, or image/document data parts.",
        );
      }
      if (content.length > 0) {
        coreMessages.push(Message.user(content));
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: AssistantContentType[] = [];
      const toolResults: ToolContentType[] = [];
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
          (part.state === "input-streaming" ||
            part.state === "input-available" ||
            part.state === "output-available")
        ) {
          content.push(
            AssistantContent.toolCall(
              part.toolCallId,
              part.toolName,
              part.input ?? {},
              part.callId,
            ),
          );
          if (part.state === "output-available") {
            toolResults.push(
              ToolContent.toolResult(
                part.toolCallId,
                outputToToolResultContent(part.output),
                part.callId,
              ),
            );
          }
        }
      }
      if (content.length > 0) {
        coreMessages.push(Message.assistant(content, message.id));
      }
      if (toolResults.length > 0) {
        coreMessages.push(Message.tool(toolResults));
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
            type: "attachment",
            attachment: userContentToAttachment(content),
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

function attachmentToUserContent(attachment: UIAttachment): UserContentType {
  if (attachment.type === "image" || isImageFileAttachment(attachment)) {
    if (attachment.url !== undefined) {
      return UserContent.imageUrl(attachment.url, imageOptions(attachment));
    }
    if (attachment.data !== undefined && attachment.mediaType !== undefined) {
      return UserContent.imageBase64(
        attachment.data,
        attachment.mediaType,
        imageOptions(attachment),
      );
    }
    throw new TypeError("Image attachments require a url or base64 data with mediaType.");
  }

  if (attachment.text !== undefined) {
    return {
      type: "document",
      source: {
        type: "text",
        text: attachment.text,
        ...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
        ...(attachment.name === undefined ? {} : { filename: attachment.name }),
      },
    };
  }

  const mediaType = attachment.mediaType ?? "application/octet-stream";
  if (attachment.url !== undefined) {
    return UserContent.documentUrl(attachment.url, mediaType, documentOptions(attachment));
  }
  if (attachment.data !== undefined) {
    return UserContent.documentBase64(attachment.data, mediaType, documentOptions(attachment));
  }

  throw new TypeError("Document attachments require a url, base64 data, or text.");
}

function userContentToAttachment(content: ImageContent | DocumentContent): UIAttachment {
  if (content.type === "image") {
    const attachment: UIAttachment = {
      id: createId("attachment"),
      type: "image",
      ...(content.detail === undefined ? {} : { detail: content.detail }),
    };
    if (content.source.type === "url") {
      attachment.url = content.source.url;
    } else {
      attachment.data = content.source.data;
      attachment.mediaType = content.source.mediaType;
    }
    return attachment;
  }

  const attachment: UIAttachment = {
    id: createId("attachment"),
    type: "document",
  };
  if (content.source.type === "url") {
    attachment.url = content.source.url;
    attachment.mediaType = content.source.mediaType;
    if (content.source.filename !== undefined) {
      attachment.name = content.source.filename;
    }
  } else if (content.source.type === "base64") {
    attachment.data = content.source.data;
    attachment.mediaType = content.source.mediaType;
    if (content.source.filename !== undefined) {
      attachment.name = content.source.filename;
    }
  } else {
    attachment.text = content.source.text;
    if (content.source.mediaType !== undefined) {
      attachment.mediaType = content.source.mediaType;
    }
    if (content.source.filename !== undefined) {
      attachment.name = content.source.filename;
    }
  }
  return attachment;
}

function isImageFileAttachment(attachment: UIAttachment): boolean {
  return attachment.type === "file" && attachment.mediaType?.startsWith("image/") === true;
}

function imageOptions(attachment: UIAttachment): { detail?: ImageDetail } {
  return attachment.detail === undefined ? {} : { detail: attachment.detail };
}

function documentOptions(attachment: UIAttachment): { filename?: string } {
  return attachment.name === undefined ? {} : { filename: attachment.name };
}

function toolResultContentToJson(content: ToolResultContent[]): JsonValue {
  if (content.length === 1 && content[0]?.type === "text") {
    return content[0].text;
  }
  return content as JsonValue;
}

function isUserContent(value: unknown): value is UserContentType {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image") {
    return isImageContent(value);
  }

  if (value.type === "document") {
    return isDocumentContent(value);
  }

  return false;
}

function isImageContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return typeof value.source.url === "string";
  }

  if (value.source.type === "base64") {
    return typeof value.source.data === "string" && typeof value.source.mediaType === "string";
  }

  return false;
}

function isDocumentContent(value: Record<string, unknown>): boolean {
  if (!isRecord(value.source)) {
    return false;
  }

  if (value.source.type === "url") {
    return typeof value.source.url === "string" && typeof value.source.mediaType === "string";
  }

  if (value.source.type === "base64") {
    return typeof value.source.data === "string" && typeof value.source.mediaType === "string";
  }

  if (value.source.type === "text") {
    return (
      typeof value.source.text === "string" &&
      (value.source.mediaType === undefined || typeof value.source.mediaType === "string")
    );
  }

  return false;
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
