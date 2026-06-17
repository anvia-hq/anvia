import path from "node:path";
import { SandboxPathError } from "./errors";

export function normalizeSandboxPath(input: string, options: { allowRoot?: boolean } = {}): string {
  if (input.length === 0) {
    throw new SandboxPathError("Sandbox path cannot be empty.");
  }

  if (input.includes("\0")) {
    throw new SandboxPathError("Sandbox path cannot contain null bytes.");
  }

  const normalized = path.posix.normalize(input.replaceAll("\\", "/"));

  if (path.posix.isAbsolute(normalized)) {
    throw new SandboxPathError(`Sandbox path must be relative: ${input}`);
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new SandboxPathError(`Sandbox path cannot leave the workspace: ${input}`);
  }

  if (normalized === "." && options.allowRoot !== true) {
    throw new SandboxPathError(
      "Sandbox path must refer to a file or directory inside the workspace.",
    );
  }

  return normalized;
}

export function containerPath(workdir: string, relativePath: string): string {
  const normalizedWorkdir = path.posix.normalize(workdir);
  const normalizedPath = normalizeSandboxPath(relativePath, { allowRoot: true });
  return normalizedPath === "."
    ? normalizedWorkdir
    : path.posix.join(normalizedWorkdir, normalizedPath);
}

export function parentSandboxPath(relativePath: string): string {
  const normalized = normalizeSandboxPath(relativePath);
  const parent = path.posix.dirname(normalized);
  return parent === "." ? "." : parent;
}
