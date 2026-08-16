import type { Message as MessageType } from "../completion/index";

export function extractRagText(message: MessageType): string | undefined {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  }

  if (message.role === "tool") {
    return message.content
      .flatMap((item) => {
        const output = item.output;
        if (output.type === "text" || output.type === "error-text") {
          return [output.value];
        }
        if (output.type === "content") {
          return output.value.flatMap((part) => (part.type === "text" ? [part.text] : []));
        }
        return [];
      })
      .join("\n");
  }

  return undefined;
}
