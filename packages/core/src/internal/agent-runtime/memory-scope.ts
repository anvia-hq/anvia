import { lifecycleSnapshot } from "../../agent/lifecycle";
import type { MemoryScope } from "../../memory/types";

export function normalizeMemoryScope(scope: MemoryScope, owner = "Agent"): MemoryScope {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    throw new TypeError(`${owner} session must be an object.`);
  }
  if (typeof scope.sessionId !== "string" || scope.sessionId.trim().length === 0) {
    throw new TypeError(`${owner} sessionId must be a non-empty string.`);
  }
  const normalized: MemoryScope = {
    sessionId: scope.sessionId.trim(),
  };
  if (scope.userId !== undefined) normalized.userId = scope.userId;
  if (scope.metadata !== undefined) normalized.metadata = scope.metadata;
  return lifecycleSnapshot(normalized);
}
