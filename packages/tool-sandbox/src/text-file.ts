import type { SandboxTextFileReadResult } from "./types";

interface CreateTextFilePageOptions {
  startLine: number;
  lineCount: number;
  maxBytes: number;
  contentStartLine?: number;
}

export function createTextFilePage(
  text: string,
  options: CreateTextFilePageOptions,
): SandboxTextFileReadResult {
  const contentStartLine = options.contentStartLine ?? 1;
  const relativeStart = Math.max(0, options.startLine - contentStartLine);
  const lines = splitLines(text).slice(relativeStart, relativeStart + options.lineCount + 1);
  const hasMoreLines = lines.length > options.lineCount;
  const selectedLines = lines.slice(0, options.lineCount);
  const selectedContent = selectedLines.join("");
  const selectedBytes = Buffer.from(selectedContent);

  if (selectedBytes.byteLength > options.maxBytes) {
    const content = decodeCompleteUtf8(selectedBytes.subarray(0, options.maxBytes));
    const lineBreaks = countLineBreaks(content);
    const endedAtLineBoundary = content.endsWith("\n");
    return {
      content,
      startLine: options.startLine,
      endLine:
        content.length === 0
          ? null
          : options.startLine + lineBreaks - (endedAtLineBoundary ? 1 : 0),
      nextStartLine: endedAtLineBoundary ? options.startLine + lineBreaks : null,
      truncated: true,
      truncatedBy: "bytes",
    };
  }

  return {
    content: selectedContent,
    startLine: options.startLine,
    endLine: selectedLines.length === 0 ? null : options.startLine + selectedLines.length - 1,
    nextStartLine: hasMoreLines ? options.startLine + selectedLines.length : null,
    truncated: hasMoreLines,
    truncatedBy: hasMoreLines ? "lines" : null,
  };
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function countLineBreaks(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === "\n") count += 1;
  }
  return count;
}

function decodeCompleteUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes, { stream: true });
}
