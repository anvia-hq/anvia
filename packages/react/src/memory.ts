import type { Message } from "@anvia/core/completion";
import { coreMessagesToUIMessages, type UIMessage } from "@anvia/core/ui";

export function initialMessagesFromMemory(messages: Message[]): UIMessage[] {
  return coreMessagesToUIMessages(messages);
}
