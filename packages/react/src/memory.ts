import type { Message } from "@anvia/core/completion";
import { isMemoryCompactionSummary } from "@anvia/core/memory";
import { coreMessagesToUIMessages, type UIMessage } from "@anvia/core/ui";

export type InitialMessagesFromMemoryOptions = {
  includeCompactionSummaries?: boolean | undefined;
};

export function initialMessagesFromMemory(
  messages: Message[],
  options: InitialMessagesFromMemoryOptions = {},
): UIMessage[] {
  const visibleMessages =
    options.includeCompactionSummaries === true
      ? messages
      : messages.filter((message) => !isMemoryCompactionSummary(message));
  return coreMessagesToUIMessages(visibleMessages);
}
