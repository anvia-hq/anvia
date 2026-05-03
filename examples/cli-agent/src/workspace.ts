import { mkdir } from "node:fs/promises";
import path from "node:path";

export const TEMP_WORKSPACE_DIR = path.resolve(process.cwd(), ".tmp");

export async function ensureTempWorkspace() {
  await mkdir(TEMP_WORKSPACE_DIR, { recursive: true });
}

export async function resolveTempPath(filePath: string) {
  await ensureTempWorkspace();

  if (path.isAbsolute(filePath)) {
    throw new Error("Path must be relative to .tmp.");
  }

  const resolvedPath = path.resolve(TEMP_WORKSPACE_DIR, filePath);
  const relativePath = path.relative(TEMP_WORKSPACE_DIR, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.length === 0) {
    throw new Error("Path must stay inside .tmp.");
  }

  return resolvedPath;
}
