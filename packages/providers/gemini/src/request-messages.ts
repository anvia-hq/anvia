import {
  type CompletionRequest,
  type Message as MessageType,
  normalizeDocuments,
} from "@anvia/core/completion";

export function orderedRequestMessages(request: CompletionRequest): MessageType[] {
  const messages: MessageType[] = [];
  messages.push(...request.chatHistory.filter((message) => message.role === "system"));
  const documents = normalizeDocuments(request.documents);
  if (documents !== undefined) {
    messages.push(documents);
  }
  messages.push(...request.chatHistory.filter((message) => message.role !== "system"));
  return messages;
}
