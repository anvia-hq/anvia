import { Text } from "ink";
import { wrapText } from "../text.js";
import type { AssistantMessage, ChatMessage, TranscriptLine } from "../types.js";
import { MarkdownLine, markdownToLines } from "./markdown.js";

export function buildTranscriptLines(messages: ChatMessage[], width: number) {
  return messages.flatMap((message) =>
    message.role === "user"
      ? userMessageLines(message.id, message.content, width)
      : assistantMessageLines(message, width),
  );
}

export function TranscriptLineView({ line }: { line: TranscriptLine }) {
  if (line.type === "spacer") {
    return <Text> </Text>;
  }

  if (line.type === "badge") {
    return (
      <Text>
        <Text backgroundColor={line.color} color="black" bold>
          {` ${line.label} `}
        </Text>
      </Text>
    );
  }

  if (line.type === "markdown") {
    return <MarkdownLine>{line.content}</MarkdownLine>;
  }

  const textProps = {
    ...(line.dimColor === undefined ? {} : { dimColor: line.dimColor }),
    ...(line.color === undefined ? {} : { color: line.color }),
  };

  return <Text {...textProps}>{line.content}</Text>;
}

function userMessageLines(id: number, content: string, width: number) {
  const contentWidth = Math.max(10, width - 2);
  const lines: TranscriptLine[] = [
    {
      key: `${id}-badge`,
      type: "badge",
      label: "You",
      color: "green",
    },
    ...wrapText(content, contentWidth).map((line, index) => ({
      key: `${id}-text-${index}`,
      type: "text" as const,
      content: `  ${line}`,
    })),
    {
      key: `${id}-spacer`,
      type: "spacer",
    },
  ];

  return lines;
}

function assistantMessageLines(message: AssistantMessage, width: number) {
  const contentWidth = Math.max(10, width - 2);
  const lines: TranscriptLine[] = [
    {
      key: `${message.id}-badge`,
      type: "badge",
      label: "Assistant",
      color: "cyan",
    },
  ];

  for (const [partIndex, part] of message.parts.entries()) {
    if (partIndex > 0) {
      lines.push({
        key: `${message.id}-${partIndex}-part-gap`,
        type: "spacer",
      });
    }

    if (part.type === "reasoning") {
      lines.push({
        key: `${message.id}-${partIndex}-reasoning-label`,
        type: "text",
        content: "  Reasoning",
        dimColor: true,
      });
      lines.push(
        ...wrapText(part.content.trim(), contentWidth).map((line, lineIndex) => ({
          key: `${message.id}-${partIndex}-reasoning-${lineIndex}`,
          type: "text" as const,
          content: `  ${line}`,
          dimColor: true,
        })),
      );
      continue;
    }

    if (part.type === "tool_call") {
      lines.push({
        key: `${message.id}-${partIndex}-tool`,
        type: "text",
        content: `  Tool: ${part.toolName}`,
        color: "yellow",
      });
      continue;
    }

    if (part.type === "tool_result") {
      continue;
    }

    lines.push(
      ...markdownToLines(part.content, contentWidth).map((line, lineIndex) => ({
        key: `${message.id}-${partIndex}-text-${lineIndex}`,
        type: "markdown" as const,
        content: `  ${line}`,
      })),
    );
  }

  if (message.parts.length === 0) {
    lines.push({
      key: `${message.id}-thinking`,
      type: "text",
      content: "  Thinking...",
    });
  }

  lines.push({
    key: `${message.id}-spacer`,
    type: "spacer",
  });

  return lines;
}
