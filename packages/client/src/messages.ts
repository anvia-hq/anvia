import type {
  AssistantContentPart,
  FilePart,
  ImagePart,
  JsonObject,
  JsonValue,
  Message,
  ToolResultOutput,
  ToolResultPart,
  UserContentPart,
} from "@anvia/core/completion";
import { isJsonValue } from "@anvia/core/completion";
import type {
  ClientDataMap,
  UIAttachment,
  UIMessage,
  UIMessagePart,
  UIToolMessagePart,
} from "./types";

type ToolLocation = { messageIndex: number; partIndex: number };

export function uiMessagesToMessages<
  Metadata extends JsonObject = JsonObject,
  Data extends ClientDataMap = ClientDataMap,
>(messages: readonly UIMessage<Metadata, Data>[]): Message<Metadata>[] {
  const result: Message<Metadata>[] = [];

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
      const content: UserContentPart[] = [];
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
      const content: AssistantContentPart[] = [];
      const toolResults: ToolResultPart[] = [];
      for (const part of message.parts) {
        if (part.type === "text") {
          content.push(textContent(part.text, part.signature));
        } else if (part.type === "reasoning") {
          content.push({
            type: "reasoning",
            text: part.text,
            ...(part.reasoningId === undefined ? {} : { id: part.reasoningId }),
            ...(part.content === undefined ? {} : { details: part.content }),
          });
        } else if (part.type === "tool") {
          content.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            ...(part.callId === undefined ? {} : { callId: part.callId }),
            toolName: part.toolName,
            input: part.input ?? {},
            ...(part.signature === undefined ? {} : { signature: part.signature }),
          });
          if (part.state === "output-available" || part.state === "error") {
            toolResults.push(toolResultFromPart(part));
          }
        } else if (part.type === "attachment") {
          content.push(attachmentToAssistantContent(part.attachment));
        }
      }

      result.push({
        role: "assistant",
        content,
        ...(message.modelMessageId === undefined ? {} : { id: message.modelMessageId }),
        ...metadataField(message.metadata),
      });
      if (toolResults.length > 0) {
        result.push({ role: "tool", content: toolResults });
      }
      continue;
    }

    assertOnlyParts(message, ["tool", "data", "error"]);
    const content = message.parts.flatMap((part) =>
      part.type === "tool" && (part.state === "output-available" || part.state === "error")
        ? [toolResultFromPart(part)]
        : [],
    );
    result.push({ role: "tool", content, ...metadataField(message.metadata) });
  }

  return result;
}

export function messagesToUIMessages<Metadata extends JsonObject = JsonObject>(
  messages: readonly Message<Metadata>[],
): UIMessage<Metadata>[] {
  const result: UIMessage<Metadata>[] = [];
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
      const content =
        typeof message.content === "string"
          ? ([{ type: "text", text: message.content }] satisfies UserContentPart[])
          : message.content;
      const parts: UIMessagePart[] = content.map((part) => contentToUIMessagePart(part));
      result.push({
        id: createId("msg"),
        role: "user",
        parts,
        ...metadataField(message.metadata),
      });
      continue;
    }

    if (message.role === "assistant") {
      const content =
        typeof message.content === "string"
          ? ([{ type: "text", text: message.content }] satisfies AssistantContentPart[])
          : message.content;
      const parts: UIMessagePart[] = content.map(assistantContentToUIMessagePart);
      const uiMessage: UIMessage<Metadata> = {
        id: createId("msg"),
        role: "assistant",
        parts,
        ...(message.id === undefined ? {} : { modelMessageId: message.id }),
        ...metadataField(message.metadata),
      };
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
      if (content.type !== "tool-result") continue;
      const location =
        (content.callId === undefined ? undefined : byCallId.get(content.callId)) ??
        byToolCallId.get(content.toolCallId);
      const part = toolResultToUIMessagePart(content, toolNameAt(result, location));

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

function contentToUIMessagePart(content: UserContentPart): UIMessagePart {
  if (content.type === "text") {
    return {
      id: createId("part"),
      type: "text",
      text: content.text,
      ...(content.signature === undefined ? {} : { signature: content.signature }),
    };
  }
  return {
    id: createId("part"),
    type: "attachment",
    attachment: contentToAttachment(content),
  };
}

function assistantContentToUIMessagePart(content: AssistantContentPart): UIMessagePart {
  if (content.type === "text") return contentToUIMessagePart(content);
  if (content.type === "reasoning") {
    return {
      id: createId("part"),
      type: "reasoning",
      text: content.text,
      ...(content.id === undefined ? {} : { reasoningId: content.id }),
      ...(content.details === undefined ? {} : { content: content.details }),
    };
  }
  if (content.type === "tool-call") {
    return {
      id: toolPartId(content.toolCallId),
      type: "tool",
      toolName: content.toolName,
      toolCallId: content.toolCallId,
      state: "input-available",
      input: content.input,
      ...(content.callId === undefined ? {} : { callId: content.callId }),
      ...(content.signature === undefined ? {} : { signature: content.signature }),
    };
  }
  return {
    id: createId("part"),
    type: "attachment",
    attachment: contentToAttachment(content),
  };
}

function textContent(text: string, signature?: string): Extract<UserContentPart, { type: "text" }> {
  return signature === undefined ? { type: "text", text } : { type: "text", text, signature };
}

function toolResultFromPart(part: UIToolMessagePart): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    ...(part.callId === undefined ? {} : { callId: part.callId }),
    toolName: part.toolName,
    output: toolOutputFromPart(part),
  };
}

function toolOutputFromPart(part: UIToolMessagePart): ToolResultOutput {
  if (part.state === "error") {
    return { type: "error-text", value: part.error?.message ?? "Tool execution failed." };
  }
  if (part.resultContent !== undefined) {
    return { type: "content", value: part.resultContent };
  }
  const output = part.output ?? null;
  return typeof output === "string"
    ? { type: "text", value: output }
    : { type: "json", value: output };
}

function attachmentToUserContent(attachment: UIAttachment): UserContentPart {
  if (attachment.type === "image" || attachment.mediaType?.startsWith("image/") === true) {
    return attachmentToImageContent(attachment);
  }
  return attachmentToFileContent(attachment);
}

function attachmentToAssistantContent(attachment: UIAttachment): AssistantContentPart {
  return attachment.type === "image" || attachment.mediaType?.startsWith("image/") === true
    ? attachmentToImageContent(attachment)
    : attachmentToFileContent(attachment);
}

function attachmentToImageContent(attachment: UIAttachment): ImagePart {
  const image: ImagePart["image"] =
    attachment.url !== undefined
      ? { type: "url", url: attachment.url }
      : attachment.data !== undefined
        ? { type: "data", data: attachment.data }
        : (() => {
            throw new TypeError("Image attachments require a URL or base64 data.");
          })();
  return {
    type: "image",
    image,
    ...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
    ...(attachment.detail === undefined ? {} : { detail: attachment.detail }),
  };
}

function attachmentToFileContent(attachment: UIAttachment): FilePart {
  const data: FilePart["data"] =
    attachment.url !== undefined
      ? { type: "url", url: attachment.url }
      : attachment.data !== undefined
        ? { type: "data", data: attachment.data }
        : attachment.text !== undefined
          ? { type: "text", text: attachment.text }
          : (() => {
              throw new TypeError("File attachments require a URL, base64 data, or text.");
            })();
  return {
    type: "file",
    data,
    mediaType: attachment.mediaType ?? "application/octet-stream",
    ...(attachment.name === undefined ? {} : { filename: attachment.name }),
  };
}

function contentToAttachment(content: ImagePart | FilePart): UIAttachment {
  const attachment: UIAttachment = {
    id: createId("attachment"),
    type: content.type === "image" ? "image" : "file",
  };
  if (content.type === "image") {
    if (content.detail !== undefined) attachment.detail = content.detail;
    if (content.mediaType !== undefined) attachment.mediaType = content.mediaType;
    if (content.image.type === "url") attachment.url = content.image.url;
    else attachment.data = content.image.data;
    return attachment;
  }
  attachment.mediaType = content.mediaType;
  if (content.filename !== undefined) attachment.name = content.filename;
  if (content.data.type === "url") attachment.url = content.data.url;
  else if (content.data.type === "data") attachment.data = content.data.data;
  else attachment.text = content.data.text;
  return attachment;
}

function toolResultToUIMessagePart(
  content: ToolResultPart,
  fallbackToolName: string | undefined,
): UIToolMessagePart {
  const output = content.output;
  const common = {
    id: toolPartId(content.toolCallId),
    type: "tool" as const,
    toolName: content.toolName || fallbackToolName || "tool",
    toolCallId: content.toolCallId,
    ...(content.callId === undefined ? {} : { callId: content.callId }),
  };
  if (output.type === "error-text" || output.type === "error-json") {
    return {
      ...common,
      state: "error",
      error: {
        message: output.type === "error-text" ? output.value : JSON.stringify(output.value),
      },
    };
  }
  if (output.type === "execution-denied") {
    return {
      ...common,
      state: "error",
      error: { message: output.reason ?? "Tool execution was denied." },
    };
  }
  return {
    ...common,
    state: "output-available",
    output: toolResultOutput(output),
    ...(output.type === "content" ? { resultContent: output.value } : {}),
  };
}

function toolResultOutput(output: ToolResultOutput): JsonValue {
  if (output.type === "text" || output.type === "error-text") return output.value;
  if (output.type === "json" || output.type === "error-json") return output.value;
  if (output.type === "execution-denied") return output.reason ?? "Tool execution was denied.";
  return output.value.length === 1 && output.value[0]?.type === "text"
    ? output.value[0].text
    : output.value.map((part) =>
        part.type === "text" ? { ...part } : { ...part, data: { ...part.data } },
      );
}

function toolNameAt(
  messages: readonly UIMessage[],
  location: ToolLocation | undefined,
): string | undefined {
  if (location === undefined) return undefined;
  const part = messages[location.messageIndex]?.parts[location.partIndex];
  return part?.type === "tool" ? part.toolName : undefined;
}

function textFromParts(parts: readonly UIMessagePart[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function assertOnlyParts(
  message: UIMessage<JsonObject, ClientDataMap>,
  allowed: readonly UIMessagePart["type"][],
): void {
  for (const part of message.parts) {
    if (!allowed.includes(part.type)) {
      throw new TypeError(`${message.role} UI messages cannot contain ${part.type} parts.`);
    }
  }
}

function assertMetadata(metadata: JsonObject | undefined): void {
  if (metadata !== undefined && (!isJsonValue(metadata) || Array.isArray(metadata))) {
    throw new TypeError("Message metadata must be a strict JSON object.");
  }
}

function metadataField<Metadata extends JsonObject>(
  metadata: Metadata | undefined,
): { metadata?: Metadata } {
  return metadata === undefined ? {} : { metadata };
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
