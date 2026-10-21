import type { PromptBlock } from "./content.js";
import type { SessionUpdate } from "./events.js";
import { AcpError } from "./errors.js";
import { presentTool } from "./presentation.js";
import type { AcpLimits, AcpToolPresentation } from "./types.js";

/** v1 has no replay cursor: reject an oversized load atomically, never silently truncate. */
export function assertReplayFits(entries: readonly AcpTranscriptEntry[], limits: AcpLimits): void {
  if (entries.length > limits.maxReplayBatchEntries) throw new AcpError("resource_limit");
  let bytes = 2;
  if (bytes > limits.maxReplayBatchBytes) throw new AcpError("resource_limit");
  for (const entry of entries) {
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes > limits.maxReplayBatchBytes) throw new AcpError("resource_limit");
  }
}

export type AcpTranscriptEntry =
  | Exclude<SessionUpdate, { type: "text" | "thought" }>
  | { type: "text"; text: string }
  | {
      type: "user";
      content: Exclude<PromptBlock, { type: "unsupported" }>;
    };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Copy allowlisted display fields only. Never derive replay from model messages. */
export function projectTranscript(
  entry: AcpTranscriptEntry | SessionUpdate,
  cwd: string,
): AcpTranscriptEntry | undefined {
  if (!entry || typeof entry !== "object") throw new AcpError("configuration_error");
  switch (entry.type) {
    case "thought":
      return undefined;
    case "text":
      if (typeof entry.text !== "string") throw new AcpError("configuration_error");
      return { type: "text", text: entry.text };
    case "user": {
      const block = entry.content;
      if (
        !block ||
        ((block.type === "text" || block.type === "resource") && typeof block.text !== "string") ||
        ((block.type === "resource_link" || block.type === "resource") &&
          typeof block.uri !== "string") ||
        ("text" in block && typeof block.text !== "string") ||
        ("uri" in block && typeof block.uri !== "string") ||
        ("mimeType" in block &&
          block.mimeType !== undefined &&
          typeof block.mimeType !== "string") ||
        (block.type === "image" &&
          (typeof block.data !== "string" || typeof block.mimeType !== "string")) ||
        (block.type === "resource_link" &&
          (typeof block.name !== "string" ||
            (block.description !== undefined && typeof block.description !== "string")))
      )
        throw new AcpError("configuration_error");
      switch (block.type) {
        case "text":
          return { type: "user", content: { type: "text", text: block.text } };
        case "image":
          return {
            type: "user",
            content: { type: "image", data: block.data, mimeType: block.mimeType },
          };
        case "resource_link": {
          const content: Extract<PromptBlock, { type: "resource_link" }> = {
            type: "resource_link",
            uri: block.uri,
            name: block.name,
          };
          if (block.description !== undefined) content.description = block.description;
          return { type: "user", content };
        }
        case "resource": {
          const content: Extract<PromptBlock, { type: "resource" }> = {
            type: "resource",
            uri: block.uri,
            text: block.text,
          };
          if (block.mimeType !== undefined) content.mimeType = block.mimeType;
          return { type: "user", content };
        }
      }
      break;
    }
    case "tool":
      if (typeof entry.id !== "string") throw new AcpError("configuration_error");
      return { type: "tool", id: entry.id, ...projectPresentation(entry, cwd) };
    case "tool-update": {
      if (typeof entry.id !== "string") throw new AcpError("configuration_error");
      if (!["pending", "completed", "failed"].includes(entry.status))
        throw new AcpError("configuration_error");
      // Status-only updates must not reset the title/locations captured earlier.
      const metadata = projectPresentation(entry, cwd);
      const result: Mutable<Extract<SessionUpdate, { type: "tool-update" }>> = {
        type: "tool-update",
        id: entry.id,
        status: entry.status,
      };
      if (entry.title !== undefined) result.title = metadata.title;
      if (entry.kind !== undefined) result.kind = metadata.kind;
      if (entry.locations !== undefined) result.locations = metadata.locations;
      if (metadata.diffs !== undefined) result.diffs = metadata.diffs;
      if (metadata.text !== undefined) result.text = metadata.text;
      return result;
    }
  }
  // Unknown kinds (including system/provider artifacts) are never replayed.
  return undefined;
}

function projectPresentation(metadata: AcpToolPresentation, cwd: string) {
  // Stored JSON is a runtime boundary, even though hosts supply typed records.
  // Reject malformed known fields before normalization or any replay notification.
  if (
    (metadata.title !== undefined && typeof metadata.title !== "string") ||
    (metadata.kind !== undefined && typeof metadata.kind !== "string") ||
    (metadata.text !== undefined && typeof metadata.text !== "string") ||
    (metadata.locations !== undefined &&
      (!Array.isArray(metadata.locations) ||
        metadata.locations.some((location) => !location || typeof location.path !== "string"))) ||
    (metadata.diffs !== undefined &&
      (!Array.isArray(metadata.diffs) ||
        metadata.diffs.some(
          (diff) =>
            !diff ||
            typeof diff.path !== "string" ||
            typeof diff.newText !== "string" ||
            (diff.oldText !== undefined &&
              diff.oldText !== null &&
              typeof diff.oldText !== "string"),
        )))
  )
    throw new AcpError("configuration_error");
  return presentTool(undefined, cwd, metadata);
}

export class Transcript {
  readonly entries: AcpTranscriptEntry[] = [];
  private bytes = 2;
  private lastTextBytes = 0;

  constructor(
    private readonly cwd: string,
    private readonly maxBytes: number,
    entries: readonly AcpTranscriptEntry[] = [],
  ) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: AcpTranscriptEntry | SessionUpdate): void {
    const projected = projectTranscript(entry, this.cwd);
    if (!projected) return;
    const last = this.entries.at(-1);
    const textBytes = projected.type === "text" ? Buffer.byteLength(projected.text) : 0;
    const merge =
      projected.type === "text" &&
      last?.type === "text" &&
      this.lastTextBytes + textBytes <= 64 * 1024;
    // Merge display deltas only; live streaming stays unchanged. Incremental JSON
    // accounting avoids serializing the growing string on every tiny delta.
    const bytes =
      this.bytes +
      Buffer.byteLength(JSON.stringify(projected)) +
      1 -
      (merge ? Buffer.byteLength('{"type":"text","text":""}') + 1 : 0);
    if (bytes > this.maxBytes) throw new AcpError("resource_limit");
    this.bytes = bytes;
    if (merge && last?.type === "text" && projected.type === "text") {
      last.text += projected.text;
      this.lastTextBytes += textBytes;
    } else {
      this.entries.push(projected);
      this.lastTextBytes = textBytes;
    }
  }
}
