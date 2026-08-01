import { assertNonnegativeInteger, assertPositiveInteger } from "./assert";
import type { MemoryOptions, ResolvedMemoryOptions } from "./types";

export function resolveMemoryOptions(options: MemoryOptions = {}): ResolvedMemoryOptions {
  const resolved: ResolvedMemoryOptions = {
    savePolicy: options.savePolicy ?? "message",
  };
  if (options.compaction !== undefined) {
    assertPositiveInteger(options.compaction.maxMessages, "compaction.maxMessages");
    const keepRecentUserTurns = options.compaction.keepRecentUserTurns ?? 4;
    const conflictRetries = options.compaction.conflictRetries ?? 1;
    assertPositiveInteger(keepRecentUserTurns, "compaction.keepRecentUserTurns");
    assertNonnegativeInteger(conflictRetries, "compaction.conflictRetries");
    if (typeof options.compaction.compactor !== "function") {
      throw new TypeError("compaction.compactor must be a function.");
    }
    resolved.compaction = {
      maxMessages: options.compaction.maxMessages,
      keepRecentUserTurns,
      compactor: options.compaction.compactor,
      conflictRetries,
    };
  }
  return resolved;
}
