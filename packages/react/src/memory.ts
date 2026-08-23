import { messagesToUIMessages, type UIMessage } from "@anvia/client";
import type { Message } from "@anvia/core/completion";

export function initialMessagesFromMemory(messages: readonly Message[]): UIMessage[] {
  return messagesToUIMessages(messages);
}
