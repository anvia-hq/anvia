import {
  type CreateUIAttachment,
  createClientId,
  type UIAttachment,
  type UIMessage,
  type UIMessagePart,
} from "@anvia/client";
import type { SendMessageInput } from "./types";

export function createUserMessage(input: SendMessageInput): UIMessage | undefined {
  if (isUIMessage(input)) return input;
  const text = typeof input === "string" ? input : (input.text ?? "");
  const attachments = typeof input === "string" ? [] : (input.attachments ?? []);
  if (text.trim().length === 0 && attachments.length === 0) return undefined;

  const parts: UIMessagePart[] = [];
  if (text.trim().length > 0) {
    parts.push({ id: createClientId("part"), type: "text", text });
  }
  for (const attachment of attachments) {
    parts.push({
      id: createClientId("part"),
      type: "attachment",
      attachment: normalizeAttachment(attachment),
    });
  }
  return {
    id: typeof input === "string" || input.id === undefined ? createClientId("msg") : input.id,
    role: "user",
    parts,
    ...(typeof input === "string" || input.metadata === undefined
      ? {}
      : { metadata: input.metadata }),
  };
}

function normalizeAttachment(attachment: CreateUIAttachment): UIAttachment {
  return { ...attachment, id: attachment.id ?? createClientId("attachment") };
}

function isUIMessage(value: SendMessageInput): value is UIMessage {
  return typeof value === "object" && value !== null && "role" in value && "parts" in value;
}
