import type { SmoothStreamItemAdapter } from "@anvia/react";
import type { TranscriptEntry } from "../shared/types";

export const transcriptStreamAdapter: SmoothStreamItemAdapter<TranscriptEntry> = {
  getKey(entry) {
    return String(entry.entryId);
  },
  getText(entry) {
    if (entry.kind === "reasoning") {
      return entry.text;
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      return entry.text;
    }
    return undefined;
  },
  withText(entry, text) {
    if (entry.kind === "reasoning") {
      return { ...entry, text };
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      if ("tone" in entry && entry.tone === "pending") {
        return entry;
      }
      return { ...entry, text };
    }
    return entry;
  },
};

export function hasTerminalTranscriptError(entries: TranscriptEntry[]): boolean {
  const entry = entries.at(-1);
  return (
    entry?.kind === "message" &&
    entry.role === "assistant" &&
    "tone" in entry &&
    entry.tone === "error"
  );
}
