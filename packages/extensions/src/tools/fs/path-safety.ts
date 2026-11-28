import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveCanonicalRoot(rootDir: string): Promise<string> {
  const trimmed = rootDir.trim();

  if (trimmed.length === 0) {
    throw new TypeError("filesystem rootDir must not be empty.");
  }

  const canonical = await realpath(path.resolve(trimmed));
  const info = await stat(canonical);

  if (!info.isDirectory()) {
    throw new Error(`filesystem rootDir "${rootDir}" is not a directory.`);
  }

  return canonical;
}

export async function resolveSafePath(
  canonicalRoot: string,
  requestedPath: string,
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  if (requestedPath.includes("\0")) {
    throw new Error("Path must not contain null bytes.");
  }

  const normalizedInput = requestedPath.trim() === "" ? "." : requestedPath;
  const candidate = path.resolve(canonicalRoot, normalizedInput);

  if (!isPathWithinRoot(canonicalRoot, candidate)) {
    throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
  }

  try {
    const resolved = await realpath(candidate);

    if (!isPathWithinRoot(canonicalRoot, resolved)) {
      throw new Error(`Path "${requestedPath}" resolves outside rootDir via symlink.`);
    }

    return resolved;
  } catch (error) {
    if (!options.allowMissing || !isNotFoundError(error)) {
      throw error;
    }
  }

  const missingSegments: string[] = [];
  let cursor = candidate;

  while (true) {
    try {
      const ancestorReal = await realpath(cursor);

      if (!isPathWithinRoot(canonicalRoot, ancestorReal)) {
        throw new Error(`Path "${requestedPath}" resolves outside rootDir via symlink.`);
      }

      const finalPath = path.resolve(ancestorReal, ...missingSegments.reverse());

      if (!isPathWithinRoot(canonicalRoot, finalPath)) {
        throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
      }

      return finalPath;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      await assertNotDanglingSymlink(cursor, requestedPath);

      const parent = path.dirname(cursor);

      if (parent === cursor) {
        throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
      }

      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function resolveSafeDeleteTarget(
  canonicalRoot: string,
  requestedPath: string,
): Promise<string> {
  if (requestedPath.includes("\0")) {
    throw new Error("Path must not contain null bytes.");
  }

  const normalizedInput = requestedPath.trim();

  if (normalizedInput.length === 0) {
    throw new Error("Path must not be empty.");
  }

  const candidate = path.resolve(canonicalRoot, normalizedInput);

  if (!isPathWithinRoot(canonicalRoot, candidate)) {
    throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
  }

  if (candidate === canonicalRoot) {
    throw new Error("Refusing to delete workspace rootDir.");
  }

  const parentReal = await resolveSafePath(canonicalRoot, path.dirname(candidate));
  const targetPath = path.join(parentReal, path.basename(candidate));

  if (!isPathWithinRoot(canonicalRoot, targetPath) || targetPath === canonicalRoot) {
    throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
  }

  const entryStat = await lstat(targetPath);

  if (entryStat.isSymbolicLink()) {
    throw new Error(`Refusing to delete symlink "${requestedPath}".`);
  }

  if (!entryStat.isFile()) {
    throw new Error(`"${requestedPath}" is not a file.`);
  }

  return targetPath;
}

export function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function toRelativePosixPath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

async function assertNotDanglingSymlink(cursor: string, requestedPath: string): Promise<void> {
  try {
    const entry = await lstat(cursor);

    if (entry.isSymbolicLink()) {
      throw new Error(`Path "${requestedPath}" traverses a dangling symlink.`);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
