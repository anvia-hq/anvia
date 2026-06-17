import type {
  CompletionModel,
  JsonValue,
  Message as MessageType,
} from "../completion/index";
export { isStreamingCompletionModel } from "../completion/create-completion";

export function extractRagText(message: MessageType): string | undefined {
  if (message.role === "user") {
    return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  }

  if (message.role === "tool") {
    return message.content
      .flatMap((item) => item.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
      .join("\n");
  }

  return undefined;
}

export function parseJsonValue(text: string): JsonValue {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}
