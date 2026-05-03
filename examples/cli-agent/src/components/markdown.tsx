import { Text } from "ink";
import type React from "react";

type MarkdownLineProps = {
  children: string;
};

export function MarkdownLine({ children }: MarkdownLineProps) {
  return <Text>{parseInlineMarkdown(children)}</Text>;
}

export function markdownToLines(markdown: string, width: number) {
  const lines: string[] = [];

  for (const rawLine of markdown.split("\n")) {
    const normalized = normalizeMarkdownLine(rawLine);
    if (normalized.length === 0) {
      lines.push("");
      continue;
    }

    lines.push(...wrapMarkdownLine(normalized, width));
  }

  return lines;
}

function normalizeMarkdownLine(line: string) {
  return line.replace(/^(\s*)[-*]\s+/, "$1- ");
}

function wrapMarkdownLine(line: string, width: number) {
  if (line.length <= width) {
    return [line];
  }

  const bulletMatch = line.match(/^(\s*[-*]\s+)/);
  const firstPrefix = bulletMatch?.[1] ?? "";
  const nextPrefix = bulletMatch === null ? "" : " ".repeat(firstPrefix.length);
  const content = bulletMatch === null ? line : line.slice(firstPrefix.length);
  const lines: string[] = [];
  let remaining = content;
  let prefix = firstPrefix;

  while (remaining.length + prefix.length > width) {
    const availableWidth = Math.max(10, width - prefix.length);
    const breakAt = findBreakPoint(remaining, availableWidth);
    lines.push(`${prefix}${remaining.slice(0, breakAt).trimEnd()}`);
    remaining = remaining.slice(breakAt).trimStart();
    prefix = nextPrefix;
  }

  lines.push(`${prefix}${remaining}`);
  return lines;
}

function findBreakPoint(text: string, maxLength: number) {
  const candidate = text.slice(0, maxLength + 1).lastIndexOf(" ");
  return candidate > 0 ? candidate : maxLength;
}

function parseInlineMarkdown(text: string) {
  const nodes: Array<string | React.ReactElement> = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <Text key={nodes.length} bold>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <Text key={nodes.length} color="yellow">
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      nodes.push(
        <Text key={nodes.length} color="blue" underline>
          {`${match[2]} (${match[3]})`}
        </Text>,
      );
    }

    cursor = match.index + token.length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}
