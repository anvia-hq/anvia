import type { MemoryOptions, ResolvedMemoryOptions } from "./types";

export function resolveMemoryOptions(options: MemoryOptions = {}): ResolvedMemoryOptions {
  return {
    savePolicy: options.savePolicy ?? "message",
  };
}
