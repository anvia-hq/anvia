import type { Message, ToolResultPart } from "../completion";

export function textFromMessage(message: Message): string {
  if (message.role === "system") {
    return message.content;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }
      if (content.type === "file" && content.data.type === "text") {
        return [content.data.text];
      }
      if (content.type === "tool-result") {
        return textFromToolResult(content.output);
      }
      return [];
    })
    .join("\n");
}

export function rewriteMessageText(message: Message, text: string): Message {
  if (message.role === "system") {
    return { ...message, content: text };
  }
  if (message.role === "user") {
    const content = typeof message.content === "string" ? [] : message.content;
    return {
      ...message,
      content: [
        { type: "text", text },
        ...content.filter(
          (item) => item.type !== "text" && !(item.type === "file" && item.data.type === "text"),
        ),
      ],
    };
  }
  if (message.role === "assistant") {
    return { ...message, content: [{ type: "text", text }] };
  }
  return message;
}

function textFromToolResult(output: ToolResultPart["output"]): string[] {
  switch (output.type) {
    case "text":
    case "error-text":
      return [output.value];
    case "json":
    case "error-json":
      return [JSON.stringify(output.value)];
    case "content":
      return output.value.flatMap((part) => (part.type === "text" ? [part.text] : []));
    case "execution-denied":
      return output.reason === undefined ? [] : [output.reason];
  }
}
