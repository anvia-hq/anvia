import { resolve } from "node:path";
import type { AcpToolPresentation } from "./types.js";

const kinds = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);

/** Project only explicit host metadata; never infer paths or titles from raw arguments. */
export function presentTool(
  name: string | undefined,
  cwd: string,
  metadata?: AcpToolPresentation,
): Required<AcpToolPresentation> {
  const title =
    (metadata?.title ?? name ?? "Tool call")
      .replace(/\p{Cc}/gu, " ")
      .trim()
      .slice(0, 200) || "Tool call";
  return {
    title,
    kind: metadata?.kind && kinds.has(metadata.kind) ? metadata.kind : "other",
    locations: (metadata?.locations ?? []).slice(0, 100).flatMap((location) => {
      if (!location.path || /\p{Cc}/u.test(location.path)) return [];
      const path = resolve(cwd, location.path);
      const normalized: { path: string; line?: number } = { path };
      if (location.line !== undefined && Number.isSafeInteger(location.line) && location.line > 0) {
        normalized.line = location.line;
      }
      return [normalized];
    }),
  };
}
