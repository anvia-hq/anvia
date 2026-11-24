import type { Document } from "../completion";

export type ContextSourceRetrieveOptions = Readonly<{
  query: string;
  abortSignal?: AbortSignal | undefined;
}>;

export type ContextSource = Readonly<{
  readonly kind: "context-source";
  retrieve(options: ContextSourceRetrieveOptions): Promise<readonly Document[]>;
}>;

export function createContextSource(retrieve: ContextSource["retrieve"]): ContextSource {
  if (typeof retrieve !== "function") {
    throw new TypeError("ContextSource requires a retrieve function.");
  }

  return Object.freeze({
    kind: "context-source" as const,
    retrieve,
  });
}

export function isContextSource(value: unknown): value is ContextSource {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as { kind?: unknown; retrieve?: unknown };
  return candidate.kind === "context-source" && typeof candidate.retrieve === "function";
}
