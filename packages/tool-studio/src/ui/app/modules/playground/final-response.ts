import type { TranscriptEntry } from "../shared/types";

/** Select the final assistant message in each completed user exchange. */
export function finalResponseEntryIds(
  entries: TranscriptEntry[],
  isStreaming: boolean,
): Set<number> {
  const ids = new Set<number>();
  let lastEntry: TranscriptEntry | undefined;
  const finish = () => {
    if (
      lastEntry?.kind === "message" &&
      lastEntry.role === "assistant" &&
      lastEntry.tone !== "pending"
    ) {
      ids.add(lastEntry.entryId);
    }
  };
  for (const entry of entries) {
    if (entry.kind === "message" && entry.role === "user") finish();
    lastEntry = entry;
  }
  if (!isStreaming) finish();
  return ids;
}
