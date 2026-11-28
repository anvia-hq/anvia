import type { ToolResultContentPart } from "@anvia/core/completion";
import { type AgentMiddleware, createMiddleware } from "@anvia/core/tool";
import { truncateText } from "../internal/truncate";

export type ToolOutputLimitOptions = {
  /** Maximum characters allowed per tool output before truncating. */
  maxChars: number;
  /** Optional allowlist of tool names to limit. Applies to all tools when omitted. */
  tools?: readonly string[] | undefined;
  /** Suffix appended when truncated. Default `"\n...[truncated]"`. */
  suffix?: string | undefined;
};

export function toolOutputLimit(options: ToolOutputLimitOptions): AgentMiddleware {
  if (!Number.isSafeInteger(options.maxChars) || options.maxChars <= 0) {
    throw new RangeError("toolOutputLimit maxChars must be a positive safe integer.");
  }

  const toolSet = options.tools === undefined ? undefined : new Set(options.tools);
  const suffix = options.suffix ?? "\n...[truncated]";

  return createMiddleware({
    onToolOutput(args) {
      if (toolSet !== undefined && !toolSet.has(args.toolName)) {
        return undefined;
      }

      if (args.structuredResult !== undefined) {
        return truncateStructuredResult(args.structuredResult, options.maxChars, suffix);
      }

      if (args.result.length <= options.maxChars) {
        return undefined;
      }

      const { text } = truncateText(args.result, options.maxChars, suffix);
      return { result: text };
    },
  });
}

function truncateStructuredResult(
  parts: readonly ToolResultContentPart[],
  maxChars: number,
  suffix: string,
): { structuredResult: ToolResultContentPart[] } | undefined {
  let totalChars = 0;
  for (const part of parts) {
    totalChars += textLengthOfPart(part);
  }

  if (totalChars <= maxChars) {
    return undefined;
  }

  const effectiveSuffix = maxChars > suffix.length ? suffix : "";
  let remaining = maxChars - effectiveSuffix.length;
  let suffixEmitted = effectiveSuffix.length === 0;
  const nextParts: ToolResultContentPart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (remaining <= 0) {
        if (!suffixEmitted) {
          nextParts.push({ type: "text", text: effectiveSuffix });
          suffixEmitted = true;
        }

        continue;
      }

      if (part.text.length <= remaining) {
        remaining -= part.text.length;
        nextParts.push(part);
      } else {
        nextParts.push({
          ...part,
          text: `${part.text.slice(0, remaining)}${effectiveSuffix}`,
        });
        remaining = 0;
        suffixEmitted = true;
      }

      continue;
    }

    if (part.type === "file" && part.data.type === "text") {
      if (remaining <= 0) {
        if (!suffixEmitted) {
          nextParts.push({ type: "text", text: effectiveSuffix });
          suffixEmitted = true;
        }

        continue;
      }

      if (part.data.text.length <= remaining) {
        remaining -= part.data.text.length;
        nextParts.push(part);
      } else {
        nextParts.push({
          ...part,
          data: { type: "text", text: `${part.data.text.slice(0, remaining)}${effectiveSuffix}` },
        });
        remaining = 0;
        suffixEmitted = true;
      }

      continue;
    }

    nextParts.push(part);
  }

  if (!suffixEmitted) {
    nextParts.push({ type: "text", text: effectiveSuffix });
  }

  return { structuredResult: nextParts };
}

function textLengthOfPart(part: ToolResultContentPart): number {
  if (part.type === "text") return part.text.length;

  if (part.type === "file" && part.data.type === "text") return part.data.text.length;

  return 0;
}
