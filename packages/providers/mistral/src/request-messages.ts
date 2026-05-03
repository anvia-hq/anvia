import {
  type CompletionRequest,
  Message,
  type Message as MessageType,
  normalizeDocuments,
} from "@anvia/core/completion";

export type OrderedRequestMessagesOptions = {
  includeInstructionsAsSystem?: boolean;
};

export function orderedRequestMessages(
  request: CompletionRequest,
  options: OrderedRequestMessagesOptions = {},
): MessageType[] {
  const messages: MessageType[] = [];
  if (options.includeInstructionsAsSystem === true && request.instructions !== undefined) {
    messages.push(Message.system(request.instructions));
  }
  messages.push(...request.chatHistory.filter((message) => message.role === "system"));
  const documents = normalizeDocuments(request.documents);
  if (documents !== undefined) {
    messages.push(documents);
  }
  messages.push(...request.chatHistory.filter((message) => message.role !== "system"));
  return messages;
}
