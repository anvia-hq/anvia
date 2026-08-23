import {
  type ClientDataMap,
  type ClientMetadata,
  type CreateUIAttachment,
  createClientId,
  type UIAttachment,
  type UIMessage,
  type UIMessagePart,
} from "@anvia/client";
import type { SendMessageInput } from "./types";

export function createUserMessage<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(input: SendMessageInput<Metadata>): UIMessage<Metadata, Data> {
  const text = input.text ?? "";
  const attachments = input.attachments ?? [];
  if (text.trim().length === 0 && attachments.length === 0) {
    throw new TypeError("sendMessage requires nonblank text or at least one attachment.");
  }

  const parts: UIMessagePart<Data>[] = [];
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
  let message: UIMessage<Metadata, Data> = {
    id: createClientId("msg"),
    role: "user",
    parts,
  };
  if (input.metadata !== undefined) message = { ...message, metadata: input.metadata };
  return message;
}

function normalizeAttachment(attachment: CreateUIAttachment): UIAttachment {
  return { ...attachment, id: attachment.id ?? createClientId("attachment") };
}
