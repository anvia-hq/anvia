import type { ToolApprovalRequirement } from "../../tool/tool";

export function toolMayRequireApproval(requirement: unknown): boolean {
  return requirement !== undefined && requirement !== false;
}

export function assertToolApprovalRequirement(
  requirement: unknown,
  options: { allowFunction: boolean },
): asserts requirement is boolean | ToolApprovalRequirement | ((...args: never[]) => unknown) {
  if (typeof requirement === "boolean") {
    return;
  }
  if (options.allowFunction && typeof requirement === "function") {
    return;
  }
  if (typeof requirement !== "object" || requirement === null || Array.isArray(requirement)) {
    throw new TypeError(
      'Tool "requiresApproval" must be a boolean, a function, or an object with an optional string reason.',
    );
  }
  const reason = (requirement as { reason?: unknown }).reason;
  if (reason !== undefined && typeof reason !== "string") {
    throw new TypeError('Tool "requiresApproval.reason" must be a string.');
  }
}
