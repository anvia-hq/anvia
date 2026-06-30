import type { Message as MessageType } from "../completion/index";

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
