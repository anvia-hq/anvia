import type { AgentStructuredOutputFormat } from "../../agent/errors";

const JSON_FENCE_START = "```json\n";
const JSON_FENCE_CRLF_START = "```json\r\n";
const UNLABELED_FENCE_START = "```\n";
const UNLABELED_FENCE_CRLF_START = "```\r\n";
const FENCE_END = "\n```";

export const STRUCTURED_OUTPUT_RETRY_PROMPT =
  "Your previous response was invalid structured output. Return only raw JSON that matches the supplied JSON schema. Do not use Markdown fences or include commentary.";

export const STRUCTURED_OUTPUT_TRUNCATED_RETRY_PROMPT =
  "Your previous response exceeded the provider output limit. Return substantially shorter raw JSON that matches the supplied JSON schema. Do not use Markdown fences or include commentary.";

const STRUCTURED_OUTPUT_REPAIR_PREVIEW_MAX_LENGTH = 8_192;
const STRUCTURED_OUTPUT_REPAIR_PREVIEW_MARKER = "\n...[output omitted]...\n";

export type StructuredOutputRepairPreview = Readonly<{
  text: string;
  includedOutputLength: number;
}>;

export function structuredOutputRepairPreview(text: string): StructuredOutputRepairPreview {
  if (text.length <= STRUCTURED_OUTPUT_REPAIR_PREVIEW_MAX_LENGTH) {
    return { text, includedOutputLength: text.length };
  }
  const availableLength =
    STRUCTURED_OUTPUT_REPAIR_PREVIEW_MAX_LENGTH - STRUCTURED_OUTPUT_REPAIR_PREVIEW_MARKER.length;
  const headLength = Math.ceil(availableLength / 2);
  const tailLength = availableLength - headLength;
  return {
    text: `${text.slice(0, headLength)}${STRUCTURED_OUTPUT_REPAIR_PREVIEW_MARKER}${text.slice(-tailLength)}`,
    includedOutputLength: headLength + tailLength,
  };
}

export type NormalizedStructuredOutput = Readonly<{
  text: string;
  format: AgentStructuredOutputFormat;
}>;

export function normalizeStructuredOutput(text: string): NormalizedStructuredOutput {
  const trimmed = text.trim();
  const opening = fenceOpening(trimmed);
  if (opening === undefined || !trimmed.endsWith(FENCE_END)) {
    return { text: trimmed, format: "raw" };
  }

  const closingStart = trimmed.length - 3;
  const precedingNewline = closingStart - 1;
  const contentEnd =
    trimmed[precedingNewline - 1] === "\r" ? precedingNewline - 1 : precedingNewline;
  return {
    text: trimmed.slice(opening.length, contentEnd).trim(),
    format: opening.format,
  };
}

function fenceOpening(
  text: string,
): Readonly<{ length: number; format: Exclude<AgentStructuredOutputFormat, "raw"> }> | undefined {
  if (text.startsWith(JSON_FENCE_START)) {
    return { length: JSON_FENCE_START.length, format: "json-fence" };
  }
  if (text.startsWith(JSON_FENCE_CRLF_START)) {
    return { length: JSON_FENCE_CRLF_START.length, format: "json-fence" };
  }
  if (text.startsWith(UNLABELED_FENCE_START)) {
    return { length: UNLABELED_FENCE_START.length, format: "unlabeled-fence" };
  }
  if (text.startsWith(UNLABELED_FENCE_CRLF_START)) {
    return { length: UNLABELED_FENCE_CRLF_START.length, format: "unlabeled-fence" };
  }
  return undefined;
}
