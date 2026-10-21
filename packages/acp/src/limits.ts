import type { AcpLimits } from "./types.js";

const defaults: AcpLimits = {
  maxSessions: 32,
  maxPromptBytes: 10 * 1024 * 1024,
  maxTextBytes: 1024 * 1024,
  maxImageBytes: 5 * 1024 * 1024,
  maxContentBlocks: 256,
  maxHistoryBytes: 16 * 1024 * 1024,
  maxHistoryMessages: 1000,
  maxPendingRequests: 16,
  maxConcurrentRequests: 64,
  maxTerminalOutputBytes: 1024 * 1024,
  maxReplayBatchEntries: 10_000,
  maxReplayBatchBytes: 16 * 1024 * 1024,
};

export function resolveLimits(overrides: Partial<AcpLimits> = {}): AcpLimits {
  const limits = { ...defaults, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("ACP limits must be positive safe integers.");
    }
  }
  return Object.freeze(limits);
}
