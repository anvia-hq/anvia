import { resolve, posix, isAbsolute } from "node:path";
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
): PresentedTool {
  const title =
    (metadata?.title ?? name ?? "Tool call")
      .replace(/\p{Cc}/gu, " ")
      .trim()
      .slice(0, 200) || "Tool call";
  const result: PresentedTool = {
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
  if (!metadata?.diffs) return result;
  let diffBytes = 0;
  const diffs = metadata.diffs.slice(0, 20).flatMap((diff) => {
    if (!diff.path || /\p{Cc}/u.test(diff.path) || typeof diff.newText !== "string") return [];
    diffBytes += Buffer.byteLength(diff.newText) + Buffer.byteLength(diff.oldText ?? "");
    if (diffBytes > 1024 * 1024) return [];
    const normalized: { path: string; newText: string; oldText?: string | null } = {
      path: resolve(cwd, diff.path),
      newText: diff.newText,
    };
    if (diff.oldText !== undefined) normalized.oldText = diff.oldText;
    return [normalized];
  });
  return { ...result, diffs };
}

export type PresentedTool = Required<Omit<AcpToolPresentation, "diffs">> &
  Pick<AcpToolPresentation, "diffs">;

/** Map a Docker POSIX workspace path to an explicitly corresponding host directory.
 * Display mapping only: it neither mounts a volume nor grants tool access. */
export function mapSandboxPath(
  path: string,
  mapping: Readonly<{ sandboxRoot: string; hostRoot: string }>,
): string {
  if (
    !posix.isAbsolute(mapping.sandboxRoot) ||
    !isAbsolute(mapping.hostRoot) ||
    [path, mapping.sandboxRoot, mapping.hostRoot].some((value) => /[\p{Cc}\\]/u.test(value))
  ) {
    throw new TypeError("Invalid sandbox path mapping");
  }
  const child = posix.relative(mapping.sandboxRoot, posix.resolve(mapping.sandboxRoot, path));
  if (child === ".." || child.startsWith("../"))
    throw new TypeError("Path is outside the mapped sandbox root");
  return resolve(mapping.hostRoot, ...child.split("/"));
}
