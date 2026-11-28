export type TruncationResult = {
  text: string;
  truncated: boolean;
  originalLength: number;
};

export function truncateText(
  text: string,
  maxChars: number,
  suffix = "\n...[truncated]",
): TruncationResult {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("maxChars must be a positive safe integer.");
  }

  if (text.length <= maxChars) {
    return { text, truncated: false, originalLength: text.length };
  }

  if (maxChars <= suffix.length) {
    return {
      text: text.slice(0, maxChars),
      truncated: true,
      originalLength: text.length,
    };
  }

  const headLength = maxChars - suffix.length;
  return {
    text: `${text.slice(0, headLength)}${suffix}`,
    truncated: true,
    originalLength: text.length,
  };
}
