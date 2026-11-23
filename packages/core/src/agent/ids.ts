export function normalizeAgentId(id: string): string {
  if (typeof id !== "string") {
    throw new TypeError("Agent id must be a string.");
  }

  const normalized = id.trim();

  if (normalized.length === 0) {
    throw new TypeError("Agent id must be a non-empty string.");
  }

  return normalized;
}
