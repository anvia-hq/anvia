import { assertPositiveInteger } from "./assert";
import type {
  MemoryCompactionConflictRetryOptions,
  MemoryCompactor,
  MemoryOptions,
  MemorySavePolicy,
} from "./types";

type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
  compaction?:
    | {
        trigger: { afterMessages: number };
        retention: { recentUserTurns: number };
        compactor: MemoryCompactor;
        conflictRetries: false | MemoryCompactionConflictRetryOptions;
      }
    | undefined;
};

export function resolveMemoryOptions(options: MemoryOptions = {}): ResolvedMemoryOptions {
  const resolved: ResolvedMemoryOptions = {
    savePolicy: options.savePolicy ?? "message",
  };
  if (options.compaction !== undefined) {
    assertPositiveInteger(
      options.compaction.trigger.afterMessages,
      "compaction.trigger.afterMessages",
    );
    const recentUserTurns = options.compaction.retention?.recentUserTurns ?? 4;
    assertPositiveInteger(recentUserTurns, "compaction.retention.recentUserTurns");
    if (typeof options.compaction.compactor !== "function") {
      throw new TypeError("compaction.compactor must be a function.");
    }
    const conflictRetries = options.compaction.conflictRetries ?? false;
    if (conflictRetries !== false) {
      assertPositiveInteger(conflictRetries.maxAttempts, "compaction.conflictRetries.maxAttempts");
    }
    resolved.compaction = {
      trigger: {
        afterMessages: options.compaction.trigger.afterMessages,
      },
      retention: {
        recentUserTurns,
      },
      compactor: options.compaction.compactor,
      conflictRetries,
    };
  }
  return resolved;
}
