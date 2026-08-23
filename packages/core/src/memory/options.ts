import type { Message } from "../completion/types";
import { assertPositiveInteger } from "./assert";
import type {
  MemoryCompactionConflictRetryOptions,
  MemoryCompactor,
  MemoryOptions,
  MemorySavePolicy,
  MemoryTokenCounter,
} from "./types";

type ResolvedMemoryOptions = {
  savePolicy: MemorySavePolicy;
  compaction?:
    | {
        trigger: { afterTokens: number };
        retention: { recentTokens: number };
        tokenCounter: MemoryTokenCounter;
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
    const afterTokens = options.compaction.trigger.afterTokens;
    assertPositiveInteger(afterTokens, "compaction.trigger.afterTokens");
    const recentTokens = options.compaction.retention?.recentTokens ?? Math.floor(afterTokens / 4);
    assertPositiveInteger(recentTokens, "compaction.retention.recentTokens");
    if (recentTokens >= afterTokens) {
      throw new RangeError("compaction.retention.recentTokens must be less than afterTokens.");
    }
    const tokenCounter = options.compaction.tokenCounter ?? estimateMemoryTokens;
    if (typeof tokenCounter !== "function") {
      throw new TypeError("compaction.tokenCounter must be a function.");
    }
    if (typeof options.compaction.compactor !== "function") {
      throw new TypeError("compaction.compactor must be a function.");
    }
    const conflictRetries = options.compaction.conflictRetries ?? false;
    if (conflictRetries !== false) {
      assertPositiveInteger(conflictRetries.maxAttempts, "compaction.conflictRetries.maxAttempts");
    }
    resolved.compaction = {
      trigger: {
        afterTokens,
      },
      retention: {
        recentTokens,
      },
      tokenCounter,
      compactor: options.compaction.compactor,
      conflictRetries,
    };
  }
  return resolved;
}

/** Lightweight provider-neutral estimate used when no model-specific counter is supplied. */
export function estimateMemoryTokens(messages: readonly Message[]): number {
  const characters = messages.reduce(
    (total, message) =>
      total + JSON.stringify({ role: message.role, content: message.content }).length,
    0,
  );
  return messages.length === 0 ? 0 : Math.max(messages.length, Math.ceil(characters / 4));
}
