import { messagesToUIMessages, type UIMessage } from "@anvia/client";
import type { Message } from "@anvia/core/completion";

export function initialMessagesFromMemory(messages: Message[]): UIMessage[] {
  return messagesToUIMessages(messages);
}
