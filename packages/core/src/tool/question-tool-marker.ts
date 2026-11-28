import type { AnyTool } from "./tool";

const questionToolMarker = Symbol("anvia.question-tool");

export function markQuestionTool<T extends AnyTool>(tool: T): T {
  Object.defineProperty(tool, questionToolMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return tool;
}

export function hasQuestionToolMarker(tool: unknown): boolean {
  return typeof tool === "object" && tool !== null && questionToolMarker in tool;
}
