import type { UIMessage, UIMessagePart } from "@anvia/client";

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
