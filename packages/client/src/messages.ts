import type {
  AssistantContent,
  DocumentContent,
  ImageContent,
  JsonValue,
  Message,
  ToolContent,
  ToolResultContent,
  UserContent,
} from "@anvia/core/completion";
import { isJsonValue } from "@anvia/core/completion";
import type { UIAttachment, UIMessage, UIMessagePart, UIToolMessagePart } from "./types";

type ToolLocation = { messageIndex: number; partIndex: number };

export function uiMessagesToMessages(messages: UIMessage[]): Message[] {
  const result: Message[] = [];

  for (const message of messages) {
    assertMetadata(message.metadata);

    if (message.role === "system") {
      assertOnlyParts(message, ["text", "data", "error"]);
      result.push({
        role: "system",
        content: textFromParts(message.parts),
        ...metadataField(message.metadata),
      });
      continue;
    }

    if (message.role === "user") {
      assertOnlyParts(message, ["text", "attachment", "data", "error"]);
      const content: UserContent[] = [];
      for (const part of message.parts) {
        if (part.type === "text") {
          content.push(textContent(part.text, part.signature));
        } else if (part.type === "attachment") {
          content.push(attachmentToUserContent(part.attachment));
        }
      }
      result.push({ role: "user", content, ...metadataField(message.metadata) });
      continue;
    }

    if (message.role === "assistant") {
      assertOnlyParts(message, [
        "text",
        "reasoning",
        "tool",
        "attachment",
        "source",
        "data",
        "error",
      ]);
      const content: AssistantContent[] = [];
      const toolResults: ToolContent[] = [];
      for (const part of message.parts) {
        if (part.type === "text") {
          content.push(textContent(part.text, part.signature));
        } else if (part.type === "reasoning") {
          const reasoning: Extract<AssistantContent, { type: "reasoning" }> = {
            type: "reasoning",
            text: part.text,
          };
          if (part.reasoningId !== undefined) reasoning.id = part.reasoningId;
          if (part.content !== undefined) reasoning.content = part.content;
          content.push(reasoning);
        } else if (part.type === "tool" && part.state !== "error") {
          const toolCall: Extract<AssistantContent, { type: "tool_call" }> = {
            type: "tool_call",
            id: part.toolCallId,
            function: {
              name: part.toolName,
              arguments: part.input ?? {},
            },
          };
          if (part.callId !== undefined) toolCall.callId = part.callId;
          if (part.signature !== undefined) toolCall.signature = part.signature;
          if (part.additionalParams !== undefined)
            toolCall.additionalParams = part.additionalParams;
          content.push(toolCall);
          if (part.state === "output-available") {
            toolResults.push(toolResultFromPart(part));
          }
        } else if (part.type === "attachment") {
          content.push(attachmentToAssistantContent(part.attachment));
        }
      }

      const assistant: Extract<Message, { role: "assistant" }> = {
        role: "assistant",
        content,
        ...metadataField(message.metadata),
      };
      if (message.modelMessageId !== undefined) assistant.id = message.modelMessageId;
      result.push(assistant);
      if (toolResults.length > 0) {
        result.push({ role: "tool", content: toolResults });
      }
      continue;
    }

    assertOnlyParts(message, ["tool", "data", "error"]);
    const content = message.parts.flatMap((part) =>
      part.type === "tool" && part.state === "output-available" ? [toolResultFromPart(part)] : [],
    );
    result.push({ role: "tool", content, ...metadataField(message.metadata) });
  }

  return result;
}

export function messagesToUIMessages(messages: Message[]): UIMessage[] {
  const result: UIMessage[] = [];
  const byToolCallId = new Map<string, ToolLocation>();
  const byCallId = new Map<string, ToolLocation>();

  for (const message of messages) {
    assertMetadata(message.metadata);

    if (message.role === "system") {
      result.push({
        id: createId("msg"),
        role: "system",
        parts: [{ id: createId("part"), type: "text", text: message.content }],
        ...metadataField(message.metadata),
      });
      continue;
    }

    if (message.role === "user") {
      const parts: UIMessagePart[] = message.content.map((content) => {
        if (content.type === "text") {
          const part: Extract<UIMessagePart, { type: "text" }> = {
            id: createId("part"),
            type: "text",
            text: content.text,
          };
          if (content.signature !== undefined) part.signature = content.signature;
          return part;
        }
        return {
          id: createId("part"),
          type: "attachment",
          attachment: contentToAttachment(content),
        };
      });
      result.push({
        id: createId("msg"),
        role: "user",
        parts,
        ...metadataField(message.metadata),
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: UIMessagePart[] = message.content.map((content) => {
        if (content.type === "text") {
          const part: Extract<UIMessagePart, { type: "text" }> = {
            id: createId("part"),
            type: "text",
            text: content.text,
          };
          if (content.signature !== undefined) part.signature = content.signature;
          return part;
        }
        if (content.type === "reasoning") {
          const part: Extract<UIMessagePart, { type: "reasoning" }> = {
            id: createId("part"),
            type: "reasoning",
            text: content.text,
          };
          if (content.id !== undefined) part.reasoningId = content.id;
          if (content.content !== undefined) part.content = content.content;
          return part;
        }
        if (content.type === "tool_call") {
          const part: UIToolMessagePart = {
            id: toolPartId(content.id),
            type: "tool",
            toolName: content.function.name,
            toolCallId: content.id,
            state: "input-available",
            input: content.function.arguments,
          };
          if (content.callId !== undefined) part.callId = content.callId;
          if (content.signature !== undefined) part.signature = content.signature;
          if (content.additionalParams !== undefined) {
            part.additionalParams = content.additionalParams;
          }
          return part;
        }
        return {
          id: createId("part"),
          type: "attachment",
          attachment: contentToAttachment(content),
        };
      });
      const uiMessage: UIMessage = {
        id: createId("msg"),
        role: "assistant",
        parts,
        ...metadataField(message.metadata),
      };
      if (message.id !== undefined) uiMessage.modelMessageId = message.id;
      const messageIndex = result.length;
      result.push(uiMessage);
      for (const [partIndex, part] of parts.entries()) {
        if (part.type !== "tool") continue;
        const location = { messageIndex, partIndex };
        byToolCallId.set(part.toolCallId, location);
        if (part.callId !== undefined) byCallId.set(part.callId, location);
      }
      continue;
    }

    const unmerged: UIToolMessagePart[] = [];
    for (const content of message.content) {
      const location =
        (content.callId === undefined ? undefined : byCallId.get(content.callId)) ??
        byToolCallId.get(content.id);
      const output = toolResultOutput(content.content);
      const part: UIToolMessagePart = {
        id: toolPartId(content.id),
        type: "tool",
        toolName: content.toolName ?? toolNameAt(result, location) ?? "tool",
        toolCallId: content.id,
        state: "output-available",
        output,
        resultContent: content.content,
      };
      if (content.callId !== undefined) part.callId = content.callId;

      if (message.metadata === undefined && location !== undefined) {
        const owner = result[location.messageIndex];
        const existing = owner?.parts[location.partIndex];
        if (owner !== undefined && existing?.type === "tool") {
          const parts = [...owner.parts];
          parts[location.partIndex] = { ...existing, ...part, id: existing.id };
          result[location.messageIndex] = { ...owner, parts };
          continue;
        }
      }
      unmerged.push(part);
    }
    if (unmerged.length > 0 || message.metadata !== undefined) {
      result.push({
        id: createId("msg"),
        role: "tool",
        parts: unmerged,
        ...metadataField(message.metadata),
      });
    }
  }

  return result;
}

function textContent(text: string, signature?: string): Extract<UserContent, { type: "text" }> {
  return signature === undefined ? { type: "text", text } : { type: "text", text, signature };
}

function toolResultFromPart(part: UIToolMessagePart) {
  const content: ToolResultContent[] = part.resultContent ?? [
    { type: "text", text: serializeJson(part.output ?? null) },
  ];
  return {
    type: "tool_result" as const,
    id: part.toolCallId,
    content,
    ...(part.callId === undefined ? {} : { callId: part.callId }),
    ...(part.toolName.length === 0 ? {} : { toolName: part.toolName }),
  };
}

function attachmentToUserContent(attachment: UIAttachment): UserContent {
  if (attachment.type === "image" || attachment.mediaType?.startsWith("image/") === true) {
    return attachmentToImageContent(attachment);
  }
  return attachmentToDocumentContent(attachment);
}

function attachmentToAssistantContent(attachment: UIAttachment): AssistantContent {
  if (attachment.type !== "image" && attachment.mediaType?.startsWith("image/") !== true) {
    throw new TypeError("Assistant attachments must be images.");
  }
  return attachmentToImageContent(attachment);
}

function attachmentToImageContent(attachment: UIAttachment): ImageContent {
  let source: ImageContent["source"];
  if (attachment.url !== undefined) {
    source = { type: "url", url: attachment.url };
  } else if (attachment.data !== undefined && attachment.mediaType !== undefined) {
    source = { type: "base64", data: attachment.data, mediaType: attachment.mediaType };
  } else {
    throw new TypeError("Image attachments require a URL or base64 data with mediaType.");
  }
  return attachment.detail === undefined
    ? { type: "image", source }
    : { type: "image", source, detail: attachment.detail };
}

function attachmentToDocumentContent(attachment: UIAttachment): DocumentContent {
  const mediaType = attachment.mediaType ?? "application/octet-stream";
  if (attachment.url !== undefined) {
    return {
      type: "document",
      source: {
        type: "url",
        url: attachment.url,
        mediaType,
        ...(attachment.name === undefined ? {} : { filename: attachment.name }),
      },
    };
  }
  if (attachment.data !== undefined) {
    return {
      type: "document",
      source: {
        type: "base64",
        data: attachment.data,
        mediaType,
        ...(attachment.name === undefined ? {} : { filename: attachment.name }),
      },
    };
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
  throw new TypeError("Document attachments require a URL, base64 data, or text.");
}

function contentToAttachment(content: ImageContent | DocumentContent): UIAttachment {
  const attachment: UIAttachment = {
    id: createId("attachment"),
    type: content.type,
  };
  if (content.type === "image") {
    if (content.detail !== undefined) attachment.detail = content.detail;
    if (content.source.type === "url") attachment.url = content.source.url;
    else {
      attachment.data = content.source.data;
      attachment.mediaType = content.source.mediaType;
    }
    return attachment;
  }
  if (content.source.type === "url") {
    attachment.url = content.source.url;
    attachment.mediaType = content.source.mediaType;
  } else if (content.source.type === "base64") {
    attachment.data = content.source.data;
    attachment.mediaType = content.source.mediaType;
  } else {
    attachment.text = content.source.text;
    if (content.source.mediaType !== undefined) attachment.mediaType = content.source.mediaType;
  }
  if (content.source.filename !== undefined) attachment.name = content.source.filename;
  return attachment;
}

function toolResultOutput(content: ToolResultContent[]): JsonValue {
  return content.length === 1 && content[0]?.type === "text" ? content[0].text : content;
}

function toolNameAt(messages: UIMessage[], location: ToolLocation | undefined): string | undefined {
  if (location === undefined) return undefined;
  const part = messages[location.messageIndex]?.parts[location.partIndex];
  return part?.type === "tool" ? part.toolName : undefined;
}

function textFromParts(parts: UIMessagePart[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function assertOnlyParts(message: UIMessage, allowed: UIMessagePart["type"][]): void {
  for (const part of message.parts) {
    if (!allowed.includes(part.type)) {
      throw new TypeError(`${message.role} UI messages cannot contain ${part.type} parts.`);
    }
  }
}

function assertMetadata(metadata: JsonValue | undefined): void {
  if (metadata !== undefined && !isJsonValue(metadata)) {
    throw new TypeError("Message metadata must be a strict JSON value.");
  }
}

function metadataField(metadata: JsonValue | undefined): { metadata?: JsonValue } {
  return metadata === undefined ? {} : { metadata };
}

function serializeJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toolPartId(toolCallId: string): string {
  return `tool_${toolCallId}`;
}

let nextId = 0;

export function createClientId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random !== undefined) return `${prefix}_${random}`;
  nextId += 1;
  return `${prefix}_${nextId.toString(36)}`;
}

function createId(prefix: string): string {
  return createClientId(prefix);
}
