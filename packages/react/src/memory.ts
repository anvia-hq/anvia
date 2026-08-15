import { messagesToUIMessages, type UIMessage } from "@anvia/client";
import type { Message } from "@anvia/core/completion";
import { isMemoryCompactionSummary } from "@anvia/core/memory";

export type InitialMessagesFromMemoryOptions = {
  includeCompactionSummaries?: boolean;
};

export function initialMessagesFromMemory(
  messages: Message[],
  options: InitialMessagesFromMemoryOptions = {},
): UIMessage[] {
  return messagesToUIMessages(
    options.includeCompactionSummaries === true
      ? messages
      : messages.filter((message) => !isMemoryCompactionSummary(message)),
  );
}
