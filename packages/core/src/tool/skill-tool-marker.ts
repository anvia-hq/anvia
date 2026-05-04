import type { AnyTool } from "./tool";

const skillToolMarker = Symbol.for("@anvia/core.skillTool");

export function markSkillTool<T extends AnyTool>(tool: T): T {
  Object.defineProperty(tool, skillToolMarker, {
    value: true,
    enumerable: false,
  });
  return tool;
}

export function isSkillTool(tool: AnyTool | undefined): boolean {
  return tool !== undefined && (tool as Record<symbol, unknown>)[skillToolMarker] === true;
}
